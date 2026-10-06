// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LendingTypes} from "../libraries/LendingTypes.sol";

interface IPositionAdapter {
    function protocolVersion() external view returns (LendingTypes.ProtocolVersion);

    /// @notice Take custody of an LP position from `from`
    function deposit(address from, uint256 tokenId) external;

    /// @notice Return LP position to `to`
    function withdraw(address to, uint256 tokenId) external;

    /// @notice Burn all liquidity, collect underlying tokens to `tokenRecipient`,
    ///         and transfer the empty NFT to `nftRecipient`.
    /// @return token0 Position token0
    /// @return token1 Position token1
    /// @return amount0 Tokens sent to tokenRecipient
    /// @return amount1 Tokens sent to tokenRecipient
    /// @return fee Pool fee (V3) or fee tier meta (V4); used for swap routing
    function unwind(uint256 tokenId, address tokenRecipient, address nftRecipient)
        external
        returns (address token0, address token1, uint256 amount0, uint256 amount1, uint24 fee);

    /// @notice Whether this adapter currently holds the position
    function owns(uint256 tokenId) external view returns (bool);

    /// @notice Token0, token1, fee/hooks id, tickLower, tickUpper, liquidity
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
        );

    /// @notice Underlying token amounts for valuation (using provided sqrt price)
    function getAmountsForValuation(uint256 tokenId, uint160 sqrtPriceX96)
        external
        view
        returns (uint256 amount0, uint256 amount1);

    /// @notice Current pool sqrt price for the position's pool (for amount calculation)
    function getPoolSqrtPriceX96(uint256 tokenId) external view returns (uint160 sqrtPriceX96);
}
