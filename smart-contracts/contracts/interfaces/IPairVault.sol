// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @notice Per-pair ERC-4626 vault that holds idle USDC for MarketLendingModule.
interface IPairVault is IERC4626 {
    function pairId() external view returns (bytes32);
    function market() external view returns (address);

    /// @notice Idle USDC sitting in the vault (excludes assets owed by the market).
    function idleAssets() external view returns (uint256);

    /// @dev Only the market may pull idle USDC to fund borrows.
    function pullLiquidity(uint256 assets, address to) external;

    /// @dev Only the market may push repayments / recovered USDC into the vault.
    function pushLiquidity(uint256 assets) external;
}
