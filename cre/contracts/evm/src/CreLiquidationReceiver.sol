// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IMarketLiquidation {
    function liquidate(uint256 loanId) external;
    function findFirstLiquidatableLoan() external view returns (bool found, uint256 loanId);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title CreLiquidationReceiver — CRE KeystoneForwarder entrypoint for liquidations
/// @notice CRE cron reads `needsUpkeep()`, then writes a report with `abi.encode(loanId)`.
///         Only the configured forwarder may call `onReport`. Authorize this contract on the
///         market with `MarketLendingModule.setAuthorizedLiquidator(receiver, true)`.
contract CreLiquidationReceiver is Ownable, IReceiver {
    address public forwarder;
    IMarketLiquidation public market;

    error ZeroAddress();
    error InvalidSender(address sender, address expected);

    event ForwarderUpdated(address indexed previous, address indexed current);
    event MarketUpdated(address indexed previous, address indexed current);
    event CreLiquidationRequested(uint256 indexed loanId);

    constructor(address initialOwner, address forwarder_, address market_) Ownable(initialOwner) {
        if (forwarder_ == address(0) || market_ == address(0)) revert ZeroAddress();
        forwarder = forwarder_;
        market = IMarketLiquidation(market_);
    }

    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert ZeroAddress();
        emit ForwarderUpdated(forwarder, forwarder_);
        forwarder = forwarder_;
    }

    function setMarket(address market_) external onlyOwner {
        if (market_ == address(0)) revert ZeroAddress();
        emit MarketUpdated(address(market), market_);
        market = IMarketLiquidation(market_);
    }

    /// @notice CRE read helper: whether any loan is liquidatable and the first loan id.
    function needsUpkeep() external view returns (bool upkeepNeeded, uint256 loanId) {
        return market.findFirstLiquidatableLoan();
    }

    /// @inheritdoc IReceiver
    /// @dev `report` = abi.encode(uint256 loanId)
    function onReport(bytes calldata /* metadata */, bytes calldata report) external {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender, forwarder);
        uint256 loanId = abi.decode(report, (uint256));
        emit CreLiquidationRequested(loanId);
        market.liquidate(loanId);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
