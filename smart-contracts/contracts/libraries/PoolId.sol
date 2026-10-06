// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Build a deterministic pool id for whitelist keys
library PoolId {
    function v3PoolId(address token0, address token1, uint24 fee) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(uint8(3), token0, token1, fee));
    }

    function v4PoolId(address token0, address token1, uint24 fee, int24 tickSpacing, address hooks)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(uint8(4), token0, token1, fee, tickSpacing, hooks));
    }
}
