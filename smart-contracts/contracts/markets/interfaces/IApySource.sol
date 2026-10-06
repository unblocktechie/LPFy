// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice External lender APY source (manager-owned logic). Optional on MarketLendingModule.
interface IApySource {
    /// @notice Lender APY in basis points (e.g. 500 = 5%). `marketId` can be pair key or bytes32(0) for global.
    function getLenderApyBps(bytes32 marketId) external view returns (uint16 apyBps);
}
