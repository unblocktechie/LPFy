// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LendingTypes} from "../libraries/LendingTypes.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {PoolId} from "../libraries/PoolId.sol";
import {IPositionAdapter} from "../interfaces/IPositionAdapter.sol";
import {IV4PositionManager, IV4StateView, IWETH9} from "../interfaces/IUniswapV4.sol";

/// @notice Holds Uniswap V4 LP NFTs and exposes position meta / amounts.
/// @dev When `positionManager` is address(0), falls back to owner `registerPosition` (unit tests).
contract V4Adapter is IPositionAdapter, IERC721Receiver, Ownable {
    using SafeERC20 for IERC20;

    /// @dev Uniswap v4-periphery Actions
    uint256 private constant DECREASE_LIQUIDITY = 0x01;
    uint256 private constant TAKE_PAIR = 0x11;

    struct RegisteredPosition {
        address token0;
        address token1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        bool held;
        bool exists;
    }

    IV4PositionManager public immutable positionManager;
    IV4StateView public immutable stateView;
    address public lendingModule;
    /// @notice WETH used when a V4 pool currency is native (address(0)).
    address public weth;

    mapping(uint256 => bool) private _held;
    mapping(uint256 => RegisteredPosition) public registered;

    event LendingModuleSet(address indexed module);
    event WethSet(address indexed weth);
    event PositionRegistered(uint256 indexed tokenId);
    event Deposited(uint256 indexed tokenId, address indexed from);
    event Withdrawn(uint256 indexed tokenId, address indexed to);

    error OnlyLendingModule();
    error NotHeld(uint256 tokenId);
    error AlreadyHeld(uint256 tokenId);
    error NotRegistered(uint256 tokenId);
    error InvalidPosition();
    error ZeroAddress();
    error WethNotSet();

    modifier onlyLendingModule() {
        if (msg.sender != lendingModule) revert OnlyLendingModule();
        _;
    }

    constructor(address positionManager_, address stateView_, address initialOwner) Ownable(initialOwner) {
        positionManager = IV4PositionManager(positionManager_);
        stateView = IV4StateView(stateView_);
    }

    receive() external payable {}

    function setLendingModule(address module) external onlyOwner {
        lendingModule = module;
        emit LendingModuleSet(module);
    }

    function setWeth(address weth_) external onlyOwner {
        weth = weth_;
        emit WethSet(weth_);
    }

    /// @notice Test/bootstrap path when PositionManager is not wired
    function registerPosition(
        uint256 tokenId,
        address token0,
        address token1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external onlyOwner {
        require(address(positionManager) == address(0), "live");
        require(!_held[tokenId] && !registered[tokenId].held, "held");
        registered[tokenId] = RegisteredPosition({
            token0: token0,
            token1: token1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity,
            tokensOwed0: 0,
            tokensOwed1: 0,
            held: false,
            exists: true
        });
        emit PositionRegistered(tokenId);
    }

    function syncLiquidity(uint256 tokenId, uint128 liquidity) external onlyOwner {
        require(address(positionManager) == address(0), "live");
        registered[tokenId].liquidity = liquidity;
    }

    /// @notice Seed collectable amounts for the registerPosition (no-PM) test path.
    function setTokensOwed(uint256 tokenId, uint128 amount0, uint128 amount1) external onlyOwner {
        require(address(positionManager) == address(0), "live");
        RegisteredPosition storage p = registered[tokenId];
        if (!p.exists) revert NotRegistered(tokenId);
        p.tokensOwed0 = amount0;
        p.tokensOwed1 = amount1;
    }

    function protocolVersion() external pure returns (LendingTypes.ProtocolVersion) {
        return LendingTypes.ProtocolVersion.V4;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function deposit(address from, uint256 tokenId) external onlyLendingModule {
        if (_held[tokenId] || registered[tokenId].held) revert AlreadyHeld(tokenId);

        if (address(positionManager) != address(0)) {
            positionManager.safeTransferFrom(from, address(this), tokenId);
            _held[tokenId] = true;
        } else {
            RegisteredPosition storage p = registered[tokenId];
            if (!p.exists) revert NotRegistered(tokenId);
            p.held = true;
            _held[tokenId] = true;
        }
        emit Deposited(tokenId, from);
    }

    function withdraw(address to, uint256 tokenId) external onlyLendingModule {
        if (!_held[tokenId] && !registered[tokenId].held) revert NotHeld(tokenId);

        if (address(positionManager) != address(0)) {
            _held[tokenId] = false;
            positionManager.safeTransferFrom(address(this), to, tokenId);
        } else {
            RegisteredPosition storage p = registered[tokenId];
            if (!p.held) revert NotHeld(tokenId);
            p.held = false;
            _held[tokenId] = false;
        }
        emit Withdrawn(tokenId, to);
    }

    /// @inheritdoc IPositionAdapter
    /// @dev Live: PositionManager.modifyLiquidities(DECREASE_LIQUIDITY + TAKE_PAIR).
    ///      Native currency (address(0)) is wrapped to `weth` before transfer.
    function unwind(uint256 tokenId, address tokenRecipient, address nftRecipient)
        external
        onlyLendingModule
        returns (address token0, address token1, uint256 amount0, uint256 amount1, uint24 fee)
    {
        if (!_held[tokenId] && !registered[tokenId].held) revert NotHeld(tokenId);
        if (tokenRecipient == address(0) || nftRecipient == address(0)) revert ZeroAddress();

        if (address(positionManager) != address(0)) {
            return _unwindLive(tokenId, tokenRecipient, nftRecipient);
        }
        return _unwindRegistered(tokenId, tokenRecipient, nftRecipient);
    }

    function owns(uint256 tokenId) external view returns (bool) {
        return _held[tokenId] || registered[tokenId].held;
    }

    function getPositionMeta(uint256 tokenId)
        external
        view
        returns (
            address token0,
            address token1,
            bytes32 poolId,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        )
    {
        return _meta(tokenId);
    }

    function getAmountsForValuation(uint256 tokenId, uint160 sqrtPriceX96)
        external
        view
        returns (uint256 amount0, uint256 amount1)
    {
        (,,, int24 tickLower, int24 tickUpper, uint128 liquidity) = _meta(tokenId);
        uint160 sqrtA = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtRatioAtTick(tickUpper);
        (amount0, amount1) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liquidity);

        if (address(positionManager) == address(0)) {
            RegisteredPosition memory p = registered[tokenId];
            amount0 += p.tokensOwed0;
            amount1 += p.tokensOwed1;
        }
    }

    function getPoolSqrtPriceX96(uint256 tokenId) external view returns (uint160 sqrtPriceX96) {
        if (address(positionManager) != address(0) && address(stateView) != address(0)) {
            (IV4PositionManager.PoolKey memory key,) = positionManager.getPoolAndPositionInfo(tokenId);
            bytes32 uniPoolId = _uniswapPoolId(key);
            (sqrtPriceX96,,,) = stateView.getSlot0(uniPoolId);
            if (sqrtPriceX96 == 0) revert InvalidPosition();
            return sqrtPriceX96;
        }

        (,,, int24 tickLower, int24 tickUpper,) = _meta(tokenId);
        int24 mid = tickLower + (tickUpper - tickLower) / 2;
        return TickMath.getSqrtRatioAtTick(mid);
    }

    function _unwindLive(uint256 tokenId, address tokenRecipient, address nftRecipient)
        internal
        returns (address token0, address token1, uint256 amount0, uint256 amount1, uint24 fee)
    {
        (IV4PositionManager.PoolKey memory key,) = positionManager.getPoolAndPositionInfo(tokenId);
        if (key.currency1 == address(0) && key.currency0 == address(0)) revert InvalidPosition();

        fee = key.fee;
        address currency0 = key.currency0;
        address currency1 = key.currency1;
        bool native0 = currency0 == address(0);
        bool native1 = currency1 == address(0);
        if ((native0 || native1) && weth == address(0)) revert WethNotSet();

        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        uint256 ethBefore = address(this).balance;
        uint256 c0Before = native0 ? 0 : IERC20(currency0).balanceOf(address(this));
        uint256 c1Before = native1 ? 0 : IERC20(currency1).balanceOf(address(this));

        bytes memory actions =
            abi.encodePacked(uint8(DECREASE_LIQUIDITY), uint8(TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(currency0, currency1, address(this));

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        uint256 ethGot = address(this).balance - ethBefore;
        // Native ETH is always currency0 in canonical V4 pool keys; currency1-native is rare.
        if (native0 && native1) revert InvalidPosition();

        if (native0) {
            amount0 = ethGot;
            if (amount0 > 0) IWETH9(weth).deposit{value: amount0}();
            token0 = weth;
            amount1 = IERC20(currency1).balanceOf(address(this)) - c1Before;
            token1 = currency1;
        } else if (native1) {
            amount0 = IERC20(currency0).balanceOf(address(this)) - c0Before;
            token0 = currency0;
            amount1 = ethGot;
            if (amount1 > 0) IWETH9(weth).deposit{value: amount1}();
            token1 = weth;
        } else {
            amount0 = IERC20(currency0).balanceOf(address(this)) - c0Before;
            amount1 = IERC20(currency1).balanceOf(address(this)) - c1Before;
            token0 = currency0;
            token1 = currency1;
        }

        if (amount0 > 0) IERC20(token0).safeTransfer(tokenRecipient, amount0);
        if (amount1 > 0) IERC20(token1).safeTransfer(tokenRecipient, amount1);

        _held[tokenId] = false;
        positionManager.safeTransferFrom(address(this), nftRecipient, tokenId);
        emit Withdrawn(tokenId, nftRecipient);
    }

    function _unwindRegistered(uint256 tokenId, address tokenRecipient, address nftRecipient)
        internal
        returns (address token0, address token1, uint256 amount0, uint256 amount1, uint24 fee)
    {
        RegisteredPosition storage p = registered[tokenId];
        if (!p.held) revert NotHeld(tokenId);

        token0 = p.token0;
        token1 = p.token1;
        fee = p.fee;
        amount0 = p.tokensOwed0;
        amount1 = p.tokensOwed1;

        p.tokensOwed0 = 0;
        p.tokensOwed1 = 0;
        p.liquidity = 0;
        p.held = false;
        _held[tokenId] = false;

        if (amount0 > 0) IERC20(token0).safeTransfer(tokenRecipient, amount0);
        if (amount1 > 0) IERC20(token1).safeTransfer(tokenRecipient, amount1);

        // No ERC721 in the register path; nftRecipient is recorded via event for parity.
        emit Withdrawn(tokenId, nftRecipient);
    }

    function _meta(uint256 tokenId)
        internal
        view
        returns (
            address token0,
            address token1,
            bytes32 poolId,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        )
    {
        if (address(positionManager) != address(0)) {
            IV4PositionManager.PoolKey memory key;
            uint256 info;
            (key, info) = positionManager.getPoolAndPositionInfo(tokenId);
            // Canonical V4 keys sort native to currency0; currency1 must be a real token.
            if (key.currency1 == address(0)) revert InvalidPosition();
            token0 = key.currency0 == address(0) ? weth : key.currency0;
            token1 = key.currency1;
            if (key.currency0 == address(0) && weth == address(0)) token0 = address(0);
            tickLower = _tickLower(info);
            tickUpper = _tickUpper(info);
            liquidity = positionManager.getPositionLiquidity(tokenId);
            poolId = PoolId.v4PoolId(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks);
        } else {
            RegisteredPosition memory p = registered[tokenId];
            if (!p.exists) revert NotRegistered(tokenId);
            token0 = p.token0;
            token1 = p.token1;
            tickLower = p.tickLower;
            tickUpper = p.tickUpper;
            liquidity = p.liquidity;
            poolId = PoolId.v4PoolId(p.token0, p.token1, p.fee, p.tickSpacing, p.hooks);
        }
    }

    function _uniswapPoolId(IV4PositionManager.PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks));
    }

    /// @dev PositionInfo packing: [200-bit poolId][24-bit tickUpper][24-bit tickLower][8-bit subscriber]
    function _tickLower(uint256 info) internal pure returns (int24) {
        return int24(uint24((info >> 8) & 0xFFFFFF));
    }

    function _tickUpper(uint256 info) internal pure returns (int24) {
        return int24(uint24((info >> 32) & 0xFFFFFF));
    }
}
