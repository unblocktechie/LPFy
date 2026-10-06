// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice shared defaults for market v1.
library MarketsConfig {
    uint16 internal constant DEFAULT_FALLBACK_LENDER_APY_BPS = 300; // 3%
    uint16 internal constant DEFAULT_MAX_UTILIZATION_BPS = 8_000; // 80%
    uint256 internal constant SECONDS_PER_YEAR = 365 days;
}
