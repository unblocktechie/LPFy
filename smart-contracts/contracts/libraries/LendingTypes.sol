// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared enums / structs for the lending module
library LendingTypes {
    enum ProtocolVersion {
        V3,
        V4
    }

    struct PositionKey {
        ProtocolVersion version;
        uint256 tokenId;
    }

    struct PoolWhitelist {
        bool allowed;
        uint16 ltvBps; // e.g. 5000 = 50%
        uint16 liquidationThresholdBps; // e.g. 6500 = 65%
        uint16 liquidationBonusBps; // e.g. 500 = 5%
    }

    struct Loan {
        address borrower;
        ProtocolVersion version;
        uint256 tokenId;
        address debtAsset;
        uint256 debtPrincipal;
        uint256 collateralValueSnapshot;
        bool active;
    }
}
