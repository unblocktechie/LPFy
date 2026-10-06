// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LendingTypes} from "../libraries/LendingTypes.sol";

interface IValuationOracle {
    /// @notice USD value of an LP position, scaled to 1e8 (Chainlink-style)
    function getPositionValueUsd(LendingTypes.ProtocolVersion version, uint256 tokenId)
        external
        view
        returns (uint256 valueUsd);

    /// @notice Token price in USD, scaled to 1e8
    function getTokenPriceUsd(address token) external view returns (uint256 priceUsd);

    /// @notice Convert USD (1e8) to debt asset amount (native decimals)
    function convertUsdToDebtAsset(address debtAsset, uint256 valueUsd)
        external
        view
        returns (uint256 amount);
}
