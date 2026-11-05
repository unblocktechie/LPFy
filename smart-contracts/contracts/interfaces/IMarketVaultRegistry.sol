// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Market registers pair vaults (called by PairVaultFactory / owner).
interface IMarketVaultRegistry {
    function setVault(bytes32 pairId, address vault) external;
}
