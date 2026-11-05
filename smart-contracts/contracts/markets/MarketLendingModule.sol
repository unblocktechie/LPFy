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
        /// @dev Snapshot at open only; live checks use ltvBpsOf / liquidationThresholdBpsOf (pair or default).
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
    /// @notice Fallback max borrow LTV when a pair has no override (`pairLtvBps == 0`).
    uint16 public defaultLtvBps = 5_000;
    /// @notice Fallback liquidation threshold when a pair has no override (must be >= defaultLtvBps).
    uint16 public defaultLiquidationThresholdBps = 6_500;
    /// @notice Per-pair max borrow LTV. `0` → use `defaultLtvBps`.
    mapping(bytes32 => uint16) public pairLtvBps;
    /// @notice Per-pair liquidation threshold. `0` → use `defaultLiquidationThresholdBps`.
    mapping(bytes32 => uint16) public pairLiquidationThresholdBps;
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
    event PairRiskParamsUpdated(bytes32 indexed pairId, uint16 ltvBps, uint16 liquidationThresholdBps);
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
    error SwapFailed(address token, uint256 amount);
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

    /// @notice Set live LTV and liquidation threshold for one pair (both required; LT >= LTV).
    function setPairRiskParams(bytes32 pairId, uint16 ltvBps_, uint16 ltBps) external onlyOwner {
        if (ltvBps_ == 0 || ltvBps_ > 10_000) revert InvalidBps();
        if (ltBps == 0 || ltBps > 10_000) revert InvalidBps();
        if (ltBps < ltvBps_) revert ThresholdBelowLtv();
        pairLtvBps[pairId] = ltvBps_;
        pairLiquidationThresholdBps[pairId] = ltBps;
        emit PairRiskParamsUpdated(pairId, ltvBps_, ltBps);
    }

    /// @notice Clear pair overrides so the pair uses global defaults again.
    function clearPairRiskParams(bytes32 pairId) external onlyOwner {
        delete pairLtvBps[pairId];
        delete pairLiquidationThresholdBps[pairId];
        emit PairRiskParamsUpdated(pairId, 0, 0);
    }

    /// @notice Effective max-borrow LTV for a pair (pair override or global default).
    function ltvBpsOf(bytes32 pairId) public view returns (uint16) {
        uint16 overrideBps = pairLtvBps[pairId];
        return overrideBps == 0 ? defaultLtvBps : overrideBps;
    }

    /// @notice Effective liquidation threshold for a pair (pair override or global default).
    function liquidationThresholdBpsOf(bytes32 pairId) public view returns (uint16) {
        uint16 overrideBps = pairLiquidationThresholdBps[pairId];
        return overrideBps == 0 ? defaultLiquidationThresholdBps : overrideBps;
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

    /// @notice True when live collateral value is below liquidation threshold vs debt.
    /// @notice Dry-run liquidation: estimated recoveries from oracle prices (no state change).
    /// @notice First active loan below liquidation threshold (CRE / keepers scan this).
    /// @notice Liquidate an underwater loan. Only owner or an authorized liquidator (CRE receiver).
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

    /// @notice Accrue, repay up to `amount` (use type(uint256).max to clear all), then return NFT.
    /// @dev Prefer this over separate repay + withdrawCollateral to avoid dust from inter-tx accrual.
    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

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

    /// @dev Convert a token balance to USDC. Identity if already USDC; otherwise swap via V3 router.
    ///      Tries the LP fee first, then standard V3 tiers. V4 fees (e.g. 20) are not V3 pools.
}
