// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {LendingTypes} from "../libraries/LendingTypes.sol";
import {IPositionAdapter} from "../interfaces/IPositionAdapter.sol";
import {IValuationOracle} from "../interfaces/IValuationOracle.sol";
import {IPairVault} from "../interfaces/IPairVault.sol";
import {IMarketVaultAccounting} from "../interfaces/IMarketVaultAccounting.sol";
import {IMarketVaultRegistry} from "../interfaces/IMarketVaultRegistry.sol";
import {ISwapRouter} from "../interfaces/IUniswapV3.sol";
import {IApySource} from "./interfaces/IApySource.sol";
import {IBorrowRateConfig} from "./interfaces/IBorrowRateConfig.sol";
import {MarketsConfig} from "./MarketsConfig.sol";
import {PairId} from "./libraries/PairId.sol";

/// @title MarketLendingModule — per-pair USDC pools + LP NFT collateral
/// @notice Idle lender USDC lives in per-pair ERC-4626 PairVaults. This module
///         pulls vault liquidity on borrow and pushes repayments back.
///         Borrow APR and lender display APY are both per-pair.
contract MarketLendingModule is
    Ownable,
    Pausable,
    ReentrancyGuard,
    IMarketVaultAccounting,
    IMarketVaultRegistry
{
    using SafeERC20 for IERC20;

    struct Loan {
        address borrower;
        LendingTypes.ProtocolVersion version;
        uint256 tokenId;
        bytes32 pairId;
        uint256 principal;
        uint256 accruedInterest;
        uint16 borrowAprBps;
        uint64 lastAccrual;
        /// @dev Snapshot at open only; live checks use defaultLtvBps / defaultLiquidationThresholdBps.
        uint16 ltvBps;
        uint16 liquidationThresholdBps;
        bool active;
    }

    /// @dev Book-kept debt state per pair. Idle USDC sits in `vaultOf[pairId]` (ERC-4626).
    ///      `cash` / `totalShares` are legacy fields (unused after PairVault); kept for storage layout.
    struct Pool {
        uint256 cash;
        uint256 totalShares;
        uint256 totalPrincipal;
        uint256 totalAccruedInterest;
    }

    IERC20 public immutable usdc;
    IValuationOracle public oracle;
    IBorrowRateConfig public borrowRateConfig;
    IApySource public apySource;
    ISwapRouter public swapRouter;

    mapping(LendingTypes.ProtocolVersion => IPositionAdapter) public adapters;

    uint16 public maxUtilizationBps = MarketsConfig.DEFAULT_MAX_UTILIZATION_BPS;
    uint16 public fallbackLenderApyBps = MarketsConfig.DEFAULT_FALLBACK_LENDER_APY_BPS;
    /// @notice Live max borrow LTV. Applied to all loans (not the snapshot on Loan).
    uint16 public defaultLtvBps = 5_000;
    /// @notice Live liquidation threshold. Applied to all loans (must be >= defaultLtvBps).
    uint16 public defaultLiquidationThresholdBps = 6_500;
    /// @notice Slippage tolerance applied to oracle-estimated swap min-out (bps).
    uint16 public liquidationSlippageBps = 100;
    /// @notice Share of liquidation surplus sent to `feeTo`, in bps. 0 = borrower keeps all surplus.
    uint16 public liquidationFeeBps;
    /// @notice Recipient of liquidation protocol fees (independent of Ownable `owner`).
    address public feeTo;

    mapping(bytes32 => Pool) public pools;
    /// @dev Legacy lender shares; new deposits use PairVault ERC-20 balances.
    mapping(bytes32 => mapping(address => uint256)) public sharesOf;
    /// @notice ERC-4626 vault holding idle USDC for each pair.
    mapping(bytes32 => address) public vaultOf;
    /// @notice Optional factory allowed to call `setVault`.
    address public vaultFactory;

    mapping(uint256 => Loan) public loans;
    mapping(uint8 => mapping(uint256 => uint256)) public loanIdByPosition;
    mapping(address => uint256[]) private _borrowerLoans;
    uint256 public nextLoanId = 1;

    event AdaptersUpdated(address v3, address v4);
    event OracleUpdated(address oracle);
    event BorrowRateConfigUpdated(address config);
    event ApySourceUpdated(address source);
    event SwapRouterUpdated(address router);
    event FallbackLenderApyUpdated(uint16 bps);
    event MaxUtilizationUpdated(uint16 bps);
    event DefaultLtvUpdated(uint16 bps);
    event DefaultLiquidationThresholdUpdated(uint16 bps);
    event LiquidationSlippageUpdated(uint16 bps);
    event LiquidationFeeUpdated(uint16 bps);
    event FeeToUpdated(address indexed feeTo);

    event Supplied(
        bytes32 indexed pairId, address indexed lender, uint256 assets, uint256 shares
    );
    event WithdrawnSupply(
        bytes32 indexed pairId, address indexed lender, uint256 assets, uint256 shares
    );

    event Borrowed(
        uint256 indexed loanId,
        address indexed borrower,
        LendingTypes.ProtocolVersion version,
        uint256 tokenId,
        bytes32 pairId,
        uint256 amount,
        uint16 borrowAprBps,
        uint256 collateralValueUsd
    );
    event Repaid(
        uint256 indexed loanId, bytes32 indexed pairId, uint256 principalPaid, uint256 interestPaid
    );
    event CollateralWithdrawn(uint256 indexed loanId, address indexed to);
    event InterestAccrued(uint256 indexed loanId, bytes32 indexed pairId, uint256 interest);
    event Liquidated(
        uint256 indexed loanId,
        address indexed liquidator,
        address indexed borrower,
        uint256 usdcRecovered,
        uint256 debtRepaid,
        uint256 surplusToBorrower,
        uint256 shortfall,
        uint256 protocolFee
    );
    event AuthorizedLiquidatorUpdated(address indexed account, bool allowed);
    event VaultUpdated(bytes32 indexed pairId, address indexed vault);
    event VaultFactoryUpdated(address indexed factory);
    event VaultLiquidityPulled(bytes32 indexed pairId, address indexed to, uint256 assets);
    event VaultLiquidityPushed(bytes32 indexed pairId, uint256 assets);

    error AdapterMissing();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidBps();
    error PairNotSupported(bytes32 pairId);
    error PositionAlreadyUsed(uint8 version, uint256 tokenId);
    error LoanInactive(uint256 loanId);
    error NotBorrower(address caller, address borrower);
    error ExceedsLTV(uint256 requested, uint256 maxAllowed);
    error ExceedsUtilization(uint256 utilizationBps, uint16 maxBps);
    error InsufficientPoolCash(uint256 requested, uint256 available);
    error InsufficientShares();
    error DebtRemaining(uint256 loanId, uint256 remaining);
    error StillHealthy(uint256 loanId);
    error SwapRouterNotSet();
    error ThresholdBelowLtv();
    error NotLiquidationAuthority();
    error UsePairVault();
    error VaultNotSet(bytes32 pairId);
    error VaultMismatch(bytes32 pairId, address expected, address got);
    error NotVaultAuthority();

    /// @notice Extra callers allowed to liquidate (CRE receiver, backup keepers). Owner always can.
    mapping(address => bool) public authorizedLiquidators;

    constructor(
        address initialOwner,
        address usdc_,
        address oracle_,
        address borrowRateConfig_
    ) Ownable(initialOwner) {
        if (usdc_ == address(0) || oracle_ == address(0) || borrowRateConfig_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = IERC20(usdc_);
        oracle = IValuationOracle(oracle_);
        borrowRateConfig = IBorrowRateConfig(borrowRateConfig_);
        feeTo = initialOwner;
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function setAdapters(address v3, address v4) external onlyOwner {
        adapters[LendingTypes.ProtocolVersion.V3] = IPositionAdapter(v3);
        adapters[LendingTypes.ProtocolVersion.V4] = IPositionAdapter(v4);
        emit AdaptersUpdated(v3, v4);
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = IValuationOracle(oracle_);
        emit OracleUpdated(oracle_);
    }

    function setBorrowRateConfig(address config) external onlyOwner {
        if (config == address(0)) revert ZeroAddress();
        borrowRateConfig = IBorrowRateConfig(config);
        emit BorrowRateConfigUpdated(config);
    }

    function setApySource(address source) external onlyOwner {
        apySource = IApySource(source);
        emit ApySourceUpdated(source);
    }

    function setFallbackLenderApyBps(uint16 bps) external onlyOwner {
        if (bps > 10_000) revert InvalidBps();
        fallbackLenderApyBps = bps;
        emit FallbackLenderApyUpdated(bps);
    }

    function setMaxUtilizationBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 10_000) revert InvalidBps();
        maxUtilizationBps = bps;
        emit MaxUtilizationUpdated(bps);
    }

    function setDefaultLtvBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 10_000) revert InvalidBps();
        if (bps > defaultLiquidationThresholdBps) revert ThresholdBelowLtv();
        defaultLtvBps = bps;
        emit DefaultLtvUpdated(bps);
    }

    function setDefaultLiquidationThresholdBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 10_000) revert InvalidBps();
        if (bps < defaultLtvBps) revert ThresholdBelowLtv();
        defaultLiquidationThresholdBps = bps;
        emit DefaultLiquidationThresholdUpdated(bps);
    }

    /// @notice Fee taken from liquidation surplus (after the pool is repaid) and sent to `feeTo`.
    /// @param bps 500 = 5% of surplus. 0 sends the full surplus to the borrower.
    function setLiquidationFeeBps(uint16 bps) external onlyOwner {
        if (bps > 10_000) revert InvalidBps();
        liquidationFeeBps = bps;
        emit LiquidationFeeUpdated(bps);
    }

    /// @notice Wallet that receives liquidation protocol fees. Does not change Ownable admin.
    function setFeeTo(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        feeTo = account;
        emit FeeToUpdated(account);
    }

    function setLiquidationSlippageBps(uint16 bps) external onlyOwner {
        if (bps > 2_000) revert InvalidBps();
        liquidationSlippageBps = bps;
        emit LiquidationSlippageUpdated(bps);
    }

    function setSwapRouter(address router) external onlyOwner {
        swapRouter = ISwapRouter(router);
        emit SwapRouterUpdated(router);
    }

    function setAuthorizedLiquidator(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        authorizedLiquidators[account] = allowed;
        emit AuthorizedLiquidatorUpdated(account, allowed);
    }

    function setVaultFactory(address factory) external onlyOwner {
        vaultFactory = factory;
        emit VaultFactoryUpdated(factory);
    }

    /// @inheritdoc IMarketVaultRegistry
    function setVault(bytes32 pairId, address vault) external override {
        if (msg.sender != owner() && msg.sender != vaultFactory) revert NotVaultAuthority();
        if (vault == address(0)) revert ZeroAddress();
        if (IPairVault(vault).pairId() != pairId) {
            revert VaultMismatch(pairId, address(uint160(uint256(pairId))), vault);
        }
        if (IPairVault(vault).market() != address(this)) {
            revert VaultMismatch(pairId, address(this), IPairVault(vault).market());
        }
        vaultOf[pairId] = vault;
        emit VaultUpdated(pairId, vault);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Views — per-pair pool
    // -------------------------------------------------------------------------

    function pairIdOf(address tokenA, address tokenB) public pure returns (bytes32) {
        return PairId.id(tokenA, tokenB);
    }

    function cashBalance(bytes32 pairId) public view returns (uint256) {
        return _idleCash(pairId);
    }

    function totalAssets(bytes32 pairId) public view returns (uint256) {
        Pool storage p = pools[pairId];
        return _idleCash(pairId) + p.totalPrincipal + p.totalAccruedInterest;
    }

    /// @inheritdoc IMarketVaultAccounting
    function assetsOwedToVault(bytes32 pairId) external view override returns (uint256) {
        Pool storage p = pools[pairId];
        return p.totalPrincipal + p.totalAccruedInterest;
    }

    function utilizationBps(bytes32 pairId) public view returns (uint256) {
        uint256 assets = totalAssets(pairId);
        if (assets == 0) return 0;
        return (pools[pairId].totalPrincipal * 10_000) / assets;
    }

    function availableToBorrow(bytes32 pairId) public view returns (uint256) {
        Pool storage p = pools[pairId];
        uint256 idle = _idleCash(pairId);
        uint256 assets = idle + p.totalPrincipal + p.totalAccruedInterest;
        if (assets == 0) return 0;
        uint256 maxDebt = (assets * maxUtilizationBps) / 10_000;
        if (p.totalPrincipal >= maxDebt) return 0;
        uint256 room = maxDebt - p.totalPrincipal;
        return room < idle ? room : idle;
    }

    function availableToWithdraw(bytes32 pairId) public view returns (uint256) {
        return _idleCash(pairId);
    }

    /// @notice Lender display APY for this pair (marketId = pairId).
    function getLenderApyBps(bytes32 pairId) public view returns (uint16) {
        if (address(apySource) != address(0)) {
            return apySource.getLenderApyBps(pairId);
        }
        return fallbackLenderApyBps;
    }

    function convertToShares(bytes32 pairId, uint256 assets) public view returns (uint256) {
        uint256 shareSupply = pools[pairId].totalShares;
        if (shareSupply == 0) return assets;
        uint256 ta = totalAssets(pairId);
        if (ta == 0) return assets;
        return (assets * shareSupply) / ta;
    }

    function convertToAssets(bytes32 pairId, uint256 shares) public view returns (uint256) {
        uint256 shareSupply = pools[pairId].totalShares;
        if (shareSupply == 0) return shares;
        return (shares * totalAssets(pairId)) / shareSupply;
    }

    function previewBorrow(LendingTypes.ProtocolVersion version, uint256 tokenId)
        external
        view
        returns (
            bytes32 pairId,
            uint16 borrowAprBps,
            uint16 lenderApyBps,
            uint256 collateralValueUsd,
            uint256 maxBorrowUsdc,
            uint256 poolAvailable
        )
    {
        IPositionAdapter adapter = _adapter(version);
        (address token0, address token1,,,,) = adapter.getPositionMeta(tokenId);
        pairId = PairId.id(token0, token1);
        if (!borrowRateConfig.isPairSupported(pairId)) revert PairNotSupported(pairId);
        borrowAprBps = borrowRateConfig.getBorrowAprBps(pairId);
        lenderApyBps = getLenderApyBps(pairId);

        collateralValueUsd = oracle.getPositionValueUsd(version, tokenId);
        uint256 borrowableUsd = (collateralValueUsd * defaultLtvBps) / 10_000;
        maxBorrowUsdc = oracle.convertUsdToDebtAsset(address(usdc), borrowableUsd);
        poolAvailable = availableToBorrow(pairId);
        if (maxBorrowUsdc > poolAvailable) maxBorrowUsdc = poolAvailable;
    }

    function currentDebt(uint256 loanId) public view returns (uint256 principal, uint256 interest, uint256 total) {
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);
        interest = loan.accruedInterest + _pendingInterest(loan);
        principal = loan.principal;
        total = principal + interest;
    }

    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return _borrowerLoans[borrower];
    }

    /// @notice True when live collateral value is below liquidation threshold vs debt.
    function isLiquidatable(uint256 loanId) public view returns (bool) {
        Loan storage loan = loans[loanId];
        if (!loan.active) return false;
        uint256 debt = loan.principal + loan.accruedInterest + _pendingInterest(loan);
        if (debt == 0) return false;
        uint256 valueUsd = oracle.getPositionValueUsd(loan.version, loan.tokenId);
        uint256 thresholdDebt = oracle.convertUsdToDebtAsset(
            address(usdc), (valueUsd * defaultLiquidationThresholdBps) / 10_000
        );
        return debt > thresholdDebt;
    }

    /// @notice Dry-run liquidation: estimated recoveries from oracle prices (no state change).
    function previewLiquidation(uint256 loanId)
        external
        view
        returns (
            bool liquidatable,
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1,
            uint256 estimatedUsdc,
            uint256 debt,
            uint256 shortfall
        )
    {
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);

        debt = loan.principal + loan.accruedInterest + _pendingInterest(loan);
        IPositionAdapter adapter = _adapter(loan.version);
        (token0, token1,,,,) = adapter.getPositionMeta(loan.tokenId);
        uint160 sqrtPriceX96 = adapter.getPoolSqrtPriceX96(loan.tokenId);
        (amount0, amount1) = adapter.getAmountsForValuation(loan.tokenId, sqrtPriceX96);

        uint256 valueUsd = oracle.getPositionValueUsd(loan.version, loan.tokenId);
        estimatedUsdc = oracle.convertUsdToDebtAsset(address(usdc), valueUsd);

        uint256 thresholdDebt = oracle.convertUsdToDebtAsset(
            address(usdc), (valueUsd * defaultLiquidationThresholdBps) / 10_000
        );
        liquidatable = debt > thresholdDebt;
        shortfall = estimatedUsdc >= debt ? 0 : debt - estimatedUsdc;
    }

    /// @notice First active loan below liquidation threshold (CRE / keepers scan this).
    function findFirstLiquidatableLoan()
        external
        view
        returns (bool found, uint256 loanId)
    {
        uint256 end = nextLoanId;
        for (uint256 i = 1; i < end; i++) {
            if (isLiquidatable(i)) return (true, i);
        }
        return (false, 0);
    }

    /// @notice Liquidate an underwater loan. Only owner or an authorized liquidator (CRE receiver).
    function liquidate(uint256 loanId) external nonReentrant {
        if (msg.sender != owner() && !authorizedLiquidators[msg.sender]) {
            revert NotLiquidationAuthority();
        }
        _liquidate(loanId);
    }

    // -------------------------------------------------------------------------
    // LENDER — supply to a specific pair pool
    // -------------------------------------------------------------------------

    /// @notice Deposit USDC into a pair pool — use the pair's ERC-4626 PairVault instead.
    function lendUsdc(bytes32 pairId, uint256 assets)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        pairId;
        assets;
        shares;
        revert UsePairVault();
    }

    /// @notice Convenience: lend to the pool identified by token legs — use PairVault instead.
    function lendToPair(address tokenA, address tokenB, uint256 assets)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        tokenA;
        tokenB;
        assets;
        shares;
        revert UsePairVault();
    }

    /// @notice Withdraw lender shares — redeem from the pair's PairVault instead.
    function withdrawLender(bytes32 pairId, uint256 shares)
        external
        nonReentrant
        returns (uint256 assets)
    {
        pairId;
        shares;
        assets;
        revert UsePairVault();
    }

    function withdrawFromPair(address tokenA, address tokenB, uint256 shares)
        external
        nonReentrant
        returns (uint256 assets)
    {
        tokenA;
        tokenB;
        shares;
        assets;
        revert UsePairVault();
    }

    // -------------------------------------------------------------------------
    // BORROWER — borrow from the pair pool matching the LP NFT
    // -------------------------------------------------------------------------

    function borrowWithCollateral(
        LendingTypes.ProtocolVersion version,
        uint256 tokenId,
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256 loanId) {
        loanId = _borrowWithCollateral(version, tokenId, amount);
    }

    function borrowMore(uint256 loanId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);
        if (loan.borrower != msg.sender) revert NotBorrower(msg.sender, loan.borrower);

        _accrue(loanId);

        uint256 valueUsd = oracle.getPositionValueUsd(loan.version, loan.tokenId);
        uint256 maxDebt = oracle.convertUsdToDebtAsset(
            address(usdc), (valueUsd * defaultLtvBps) / 10_000
        );
        uint256 newPrincipal = loan.principal + amount;
        if (newPrincipal + loan.accruedInterest > maxDebt) {
            revert ExceedsLTV(newPrincipal + loan.accruedInterest, maxDebt);
        }

        _assertBorrowLiquidity(loan.pairId, amount);

        Pool storage p = pools[loan.pairId];
        loan.principal = newPrincipal;
        p.totalPrincipal += amount;
        _pullFromVault(loan.pairId, amount, msg.sender);

        emit Borrowed(
            loanId, msg.sender, loan.version, loan.tokenId, loan.pairId, amount, loan.borrowAprBps, valueUsd
        );
    }

    function repay(uint256 loanId, uint256 amount) external nonReentrant returns (uint256 paid) {
        paid = _repay(loanId, amount);
    }

    /// @notice Accrue, repay up to `amount` (use type(uint256).max to clear all), then return NFT.
    /// @dev Prefer this over separate repay + withdrawCollateral to avoid dust from inter-tx accrual.
    function repayAndWithdraw(uint256 loanId, uint256 amount) external nonReentrant returns (uint256 paid) {
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);
        if (loan.borrower != msg.sender) revert NotBorrower(msg.sender, loan.borrower);

        paid = _repay(loanId, amount);

        _accrue(loanId);
        uint256 remaining = loan.principal + loan.accruedInterest;
        if (remaining != 0) revert DebtRemaining(loanId, remaining);

        loan.active = false;
        loanIdByPosition[uint8(loan.version)][loan.tokenId] = 0;
        _adapter(loan.version).withdraw(msg.sender, loan.tokenId);
        emit CollateralWithdrawn(loanId, msg.sender);
    }

    function withdrawCollateral(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);
        if (loan.borrower != msg.sender) revert NotBorrower(msg.sender, loan.borrower);

        _accrue(loanId);
        uint256 remaining = loan.principal + loan.accruedInterest;
        if (remaining != 0) revert DebtRemaining(loanId, remaining);

        loan.active = false;
        loanIdByPosition[uint8(loan.version)][loan.tokenId] = 0;
        _adapter(loan.version).withdraw(msg.sender, loan.tokenId);
        emit CollateralWithdrawn(loanId, msg.sender);
    }

    function accrueInterest(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);
        _accrue(loanId);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _repay(uint256 loanId, uint256 amount) internal returns (uint256 paid) {
        if (amount == 0) revert ZeroAmount();
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);

        _accrue(loanId);

        uint256 interestDue = loan.accruedInterest;
        uint256 principalDue = loan.principal;
        uint256 totalDue = interestDue + principalDue;
        paid = amount > totalDue ? totalDue : amount;

        usdc.safeTransferFrom(msg.sender, address(this), paid);

        Pool storage p = pools[loan.pairId];
        uint256 interestPaid;
        uint256 principalPaid;
        if (paid <= interestDue) {
            interestPaid = paid;
            loan.accruedInterest = interestDue - paid;
            p.totalAccruedInterest -= interestPaid;
        } else {
            interestPaid = interestDue;
            principalPaid = paid - interestDue;
            loan.accruedInterest = 0;
            if (interestPaid > 0) p.totalAccruedInterest -= interestPaid;
            loan.principal = principalDue - principalPaid;
            p.totalPrincipal -= principalPaid;
        }
        _pushToVault(loan.pairId, paid);

        emit Repaid(loanId, loan.pairId, principalPaid, interestPaid);
    }

    function _requireSupportedPair(bytes32 pairId) internal view {
        if (!borrowRateConfig.isPairSupported(pairId)) revert PairNotSupported(pairId);
    }

    function _idleCash(bytes32 pairId) internal view returns (uint256) {
        address vault = vaultOf[pairId];
        if (vault == address(0)) return 0;
        return IPairVault(vault).idleAssets();
    }

    function _requireVault(bytes32 pairId) internal view returns (IPairVault vault) {
        address v = vaultOf[pairId];
        if (v == address(0)) revert VaultNotSet(pairId);
        vault = IPairVault(v);
    }

    function _pullFromVault(bytes32 pairId, uint256 assets, address to) internal {
        IPairVault vault = _requireVault(pairId);
        vault.pullLiquidity(assets, to);
        emit VaultLiquidityPulled(pairId, to, assets);
    }

    function _pushToVault(bytes32 pairId, uint256 assets) internal {
        if (assets == 0) return;
        IPairVault vault = _requireVault(pairId);
        usdc.forceApprove(address(vault), assets);
        vault.pushLiquidity(assets);
        usdc.forceApprove(address(vault), 0);
        emit VaultLiquidityPushed(pairId, assets);
    }

    function _borrowWithCollateral(
        LendingTypes.ProtocolVersion version,
        uint256 tokenId,
        uint256 amount
    ) internal returns (uint256 loanId) {
        if (amount == 0) revert ZeroAmount();
        if (loanIdByPosition[uint8(version)][tokenId] != 0) {
            revert PositionAlreadyUsed(uint8(version), tokenId);
        }

        IPositionAdapter adapter = _adapter(version);
        adapter.deposit(msg.sender, tokenId);

        (address token0, address token1,,,,) = adapter.getPositionMeta(tokenId);
        bytes32 pairId = PairId.id(token0, token1);
        _requireSupportedPair(pairId);

        uint16 aprBps = borrowRateConfig.getBorrowAprBps(pairId);
        uint256 valueUsd = oracle.getPositionValueUsd(version, tokenId);
        uint256 maxDebt = oracle.convertUsdToDebtAsset(
            address(usdc), (valueUsd * defaultLtvBps) / 10_000
        );
        if (amount > maxDebt) revert ExceedsLTV(amount, maxDebt);

        _assertBorrowLiquidity(pairId, amount);

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            version: version,
            tokenId: tokenId,
            pairId: pairId,
            principal: amount,
            accruedInterest: 0,
            borrowAprBps: aprBps,
            lastAccrual: uint64(block.timestamp),
            // Historical snapshot only — live risk uses defaultLtvBps / defaultLiquidationThresholdBps.
            ltvBps: defaultLtvBps,
            liquidationThresholdBps: defaultLiquidationThresholdBps,
            active: true
        });
        loanIdByPosition[uint8(version)][tokenId] = loanId;
        _borrowerLoans[msg.sender].push(loanId);

        Pool storage p = pools[pairId];
        p.totalPrincipal += amount;
        _pullFromVault(pairId, amount, msg.sender);

        emit Borrowed(loanId, msg.sender, version, tokenId, pairId, amount, aprBps, valueUsd);
    }

    function _assertBorrowLiquidity(bytes32 pairId, uint256 amount) internal view {
        uint256 avail = availableToBorrow(pairId);
        if (amount > avail) revert InsufficientPoolCash(amount, avail);

        Pool storage p = pools[pairId];
        uint256 idle = _idleCash(pairId);
        uint256 assetsAfter = idle + p.totalPrincipal + p.totalAccruedInterest;
        uint256 util = ((p.totalPrincipal + amount) * 10_000) / (assetsAfter == 0 ? 1 : assetsAfter);
        if (util > maxUtilizationBps) revert ExceedsUtilization(util, maxUtilizationBps);
    }

    function _accrue(uint256 loanId) internal {
        Loan storage loan = loans[loanId];
        uint256 pending = _pendingInterest(loan);
        if (pending == 0) {
            loan.lastAccrual = uint64(block.timestamp);
            return;
        }
        loan.accruedInterest += pending;
        pools[loan.pairId].totalAccruedInterest += pending;
        loan.lastAccrual = uint64(block.timestamp);
        emit InterestAccrued(loanId, loan.pairId, pending);
    }

    function _pendingInterest(Loan storage loan) internal view returns (uint256) {
        if (loan.principal == 0 || loan.borrowAprBps == 0) return 0;
        uint256 dt = block.timestamp - uint256(loan.lastAccrual);
        if (dt == 0) return 0;
        return (loan.principal * uint256(loan.borrowAprBps) * dt)
            / (10_000 * MarketsConfig.SECONDS_PER_YEAR);
    }

    function _adapter(LendingTypes.ProtocolVersion version) internal view returns (IPositionAdapter a) {
        a = adapters[version];
        if (address(a) == address(0)) revert AdapterMissing();
    }

    function _liquidate(uint256 loanId) internal {
        Loan storage loan = loans[loanId];
        if (!loan.active) revert LoanInactive(loanId);

        _accrue(loanId);

        uint256 debt = loan.principal + loan.accruedInterest;
        if (debt == 0) revert StillHealthy(loanId);

        uint256 valueUsd = oracle.getPositionValueUsd(loan.version, loan.tokenId);
        uint256 thresholdDebt = oracle.convertUsdToDebtAsset(
            address(usdc), (valueUsd * defaultLiquidationThresholdBps) / 10_000
        );
        if (debt <= thresholdDebt) revert StillHealthy(loanId);

        address borrower = loan.borrower;
        LendingTypes.ProtocolVersion version = loan.version;
        uint256 tokenId = loan.tokenId;
        bytes32 pairId = loan.pairId;
        uint256 principalDue = loan.principal;
        uint256 interestDue = loan.accruedInterest;

        uint256 usdcBefore = usdc.balanceOf(address(this));

        IPositionAdapter adapter = _adapter(version);
        (address token0, address token1, uint256 amount0, uint256 amount1, uint24 fee) =
            adapter.unwind(tokenId, address(this), borrower);

        _swapToUsdc(token0, amount0, fee);
        _swapToUsdc(token1, amount1, fee);

        uint256 usdcRecovered = usdc.balanceOf(address(this)) - usdcBefore;

        uint256 repayAmount = usdcRecovered > debt ? debt : usdcRecovered;
        uint256 interestPaid = repayAmount > interestDue ? interestDue : repayAmount;
        uint256 principalPaid = repayAmount - interestPaid;
        if (principalPaid > principalDue) principalPaid = principalDue;

        Pool storage p = pools[pairId];
        if (interestPaid > 0) p.totalAccruedInterest -= interestPaid;
        if (interestDue > interestPaid) p.totalAccruedInterest -= (interestDue - interestPaid);
        if (principalPaid > 0) p.totalPrincipal -= principalPaid;
        if (principalDue > principalPaid) p.totalPrincipal -= (principalDue - principalPaid);
        _pushToVault(pairId, repayAmount);

        uint256 surplus = usdcRecovered > debt ? usdcRecovered - debt : 0;
        uint256 shortfall = debt > usdcRecovered ? debt - usdcRecovered : 0;
        uint256 protocolFee = (surplus * liquidationFeeBps) / 10_000;
        uint256 borrowerSurplus = surplus - protocolFee;
        if (protocolFee > 0) usdc.safeTransfer(feeTo, protocolFee);
        if (borrowerSurplus > 0) usdc.safeTransfer(borrower, borrowerSurplus);

        loan.principal = 0;
        loan.accruedInterest = 0;
        loan.active = false;
        loanIdByPosition[uint8(version)][tokenId] = 0;

        emit Liquidated(
            loanId, msg.sender, borrower, usdcRecovered, repayAmount, borrowerSurplus, shortfall, protocolFee
        );
    }

    /// @dev Convert a token balance to USDC. Identity if already USDC; otherwise swap via router.
    function _swapToUsdc(address token, uint256 amount, uint24 fee) internal returns (uint256 usdcOut) {
        if (amount == 0) return 0;
        if (token == address(usdc)) return amount;

        if (address(swapRouter) == address(0)) revert SwapRouterNotSet();

        uint256 valueUsd = _tokenAmountToUsd(token, amount);
        uint256 estimatedUsdc = oracle.convertUsdToDebtAsset(address(usdc), valueUsd);
        uint256 minOut = (estimatedUsdc * (10_000 - liquidationSlippageBps)) / 10_000;

        IERC20(token).forceApprove(address(swapRouter), amount);
        usdcOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: address(usdc),
                fee: fee,
                recipient: address(this),
                amountIn: amount,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(token).forceApprove(address(swapRouter), 0);
    }

    function _tokenAmountToUsd(address token, uint256 amount) internal view returns (uint256) {
        uint256 priceUsd = oracle.getTokenPriceUsd(token);
        uint8 dec = IERC20Metadata(token).decimals();
        return (amount * priceUsd) / (10 ** uint256(dec));
    }
}
