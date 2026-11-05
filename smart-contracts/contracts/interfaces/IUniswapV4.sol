// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Uniswap V4 PositionManager / StateView surfaces used by V4Adapter
interface IV4PositionManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory poolKey, uint256 info);

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);

    function ownerOf(uint256 tokenId) external view returns (address);

    function getApproved(uint256 tokenId) external view returns (address);

    function isApprovedForAll(address owner, address operator) external view returns (bool);

    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    /// @notice Unlock PoolManager and batch liquidity actions (decrease + take pair, etc.).
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface IV4StateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

/// @notice Minimal WETH for wrapping native currency0/1 during V4 unwind
interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}
