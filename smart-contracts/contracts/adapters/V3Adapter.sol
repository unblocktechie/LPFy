// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LendingTypes} from "../libraries/LendingTypes.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {PoolId} from "../libraries/PoolId.sol";
import {IPositionAdapter} from "../interfaces/IPositionAdapter.sol";
import {
    INonfungiblePositionManager,
    IUniswapV3Factory,
    IUniswapV3Pool
} from "../interfaces/IUniswapV3.sol";

/// @notice Holds Uniswap V3 LP NFTs and exposes position meta / amounts
contract V3Adapter is IPositionAdapter, IERC721Receiver, Ownable {
    INonfungiblePositionManager public immutable npm;
    IUniswapV3Factory public immutable factory;
    address public lendingModule;

    mapping(uint256 => bool) private _held;

    event LendingModuleSet(address indexed module);
    event Deposited(uint256 indexed tokenId, address indexed from);
    event Withdrawn(uint256 indexed tokenId, address indexed to);

    error OnlyLendingModule();
    error NotHeld(uint256 tokenId);
    error AlreadyHeld(uint256 tokenId);
    error PoolNotFound();
    error ZeroAddress();

    modifier onlyLendingModule() {
        if (msg.sender != lendingModule) revert OnlyLendingModule();
        _;
    }

    constructor(address npm_, address factory_, address initialOwner) Ownable(initialOwner) {
        npm = INonfungiblePositionManager(npm_);
        factory = IUniswapV3Factory(factory_);
    }

    function setLendingModule(address module) external onlyOwner {
        lendingModule = module;
        emit LendingModuleSet(module);
    }

    function protocolVersion() external pure returns (LendingTypes.ProtocolVersion) {
        return LendingTypes.ProtocolVersion.V3;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function deposit(address from, uint256 tokenId) external onlyLendingModule {
        if (_held[tokenId]) revert AlreadyHeld(tokenId);
        npm.safeTransferFrom(from, address(this), tokenId);
        _held[tokenId] = true;
        emit Deposited(tokenId, from);
    }

    function withdraw(address to, uint256 tokenId) external onlyLendingModule {
        if (!_held[tokenId]) revert NotHeld(tokenId);
        _held[tokenId] = false;
        npm.safeTransferFrom(address(this), to, tokenId);
        emit Withdrawn(tokenId, to);
    }

    /// @inheritdoc IPositionAdapter
    function unwind(uint256 tokenId, address tokenRecipient, address nftRecipient)
        external
        onlyLendingModule
        returns (address token0, address token1, uint256 amount0, uint256 amount1, uint24 fee)
    {
        if (!_held[tokenId]) revert NotHeld(tokenId);
        if (tokenRecipient == address(0) || nftRecipient == address(0)) revert ZeroAddress();

        uint128 liquidity;
        (,, token0, token1, fee,,, liquidity,,,,) = npm.positions(tokenId);

        if (liquidity > 0) {
            npm.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: tokenId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
        }

        (amount0, amount1) = npm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: tokenRecipient,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        _held[tokenId] = false;
        npm.safeTransferFrom(address(this), nftRecipient, tokenId);
        emit Withdrawn(tokenId, nftRecipient);
    }

    function owns(uint256 tokenId) external view returns (bool) {
        return _held[tokenId];
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
        uint24 fee;
        (,, token0, token1, fee, tickLower, tickUpper, liquidity,,,,) = npm.positions(tokenId);
        poolId = PoolId.v3PoolId(token0, token1, fee);
    }

    function getPoolSqrtPriceX96(uint256 tokenId) external view returns (uint160 sqrtPriceX96) {
        (,, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper,,,,,) =
            npm.positions(tokenId);

        // Test/local fallback when factory is not set
        if (address(factory) == address(0)) {
            int24 mid = tickLower + (tickUpper - tickLower) / 2;
            return TickMath.getSqrtRatioAtTick(mid);
        }

        address pool = factory.getPool(token0, token1, fee);
        if (pool == address(0)) revert PoolNotFound();
        (sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
    }

    function getAmountsForValuation(uint256 tokenId, uint160 sqrtPriceX96)
        external
        view
        returns (uint256 amount0, uint256 amount1)
    {
        (
            ,
            ,
            ,
            ,
            ,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            ,
            ,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = npm.positions(tokenId);
        uint160 sqrtA = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtRatioAtTick(tickUpper);
        (amount0, amount1) =
            LiquidityAmounts.getAmountsForLiquidity(sqrtPriceX96, sqrtA, sqrtB, liquidity);
        // include uncollected fees
        amount0 += tokensOwed0;
        amount1 += tokensOwed1;
    }
}
