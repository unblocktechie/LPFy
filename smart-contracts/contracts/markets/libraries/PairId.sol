// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library PairId {
    /// @notice Canonical pair id: keccak256(tokenA, tokenB) with tokenA < tokenB.
    function id(address tokenA, address tokenB) internal pure returns (bytes32) {
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }
}
