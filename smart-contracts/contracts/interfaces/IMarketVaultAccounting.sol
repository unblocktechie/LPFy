// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal market surface PairVault needs for share pricing.
interface IMarketVaultAccounting {
    /// @notice Principal + accrued interest owed back to the pair vault (debt-token units).
    function assetsOwedToVault(bytes32 pairId) external view returns (uint256);
}
