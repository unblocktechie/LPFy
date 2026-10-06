// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Per collateral-pair borrow APR (charged to borrowers → funds lender ROI).
interface IBorrowRateConfig {
    /// @notice Borrow APR in bps for a sorted token pair key.
    function getBorrowAprBps(bytes32 pairId) external view returns (uint16 aprBps);

    function isPairSupported(bytes32 pairId) external view returns (bool);
}
