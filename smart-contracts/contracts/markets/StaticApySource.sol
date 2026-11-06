// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IApySource} from "./interfaces/IApySource.sol";

/// @notice Simple owner-configured lender APY. Replace with manager contract via MarketLendingModule.setApySource.
contract StaticApySource is IApySource, Ownable {
    mapping(bytes32 => uint16) public apyBps;
    uint16 public defaultApyBps;

    event ApySet(bytes32 indexed marketId, uint16 apyBps);
    event DefaultApySet(uint16 apyBps);

    error InvalidApy();

    constructor(address initialOwner, uint16 defaultApyBps_) Ownable(initialOwner) {
        if (defaultApyBps_ > 10_000) revert InvalidApy();
        defaultApyBps = defaultApyBps_;
    }

    function setDefaultApyBps(uint16 bps) external onlyOwner {
        if (bps > 10_000) revert InvalidApy();
        defaultApyBps = bps;
        emit DefaultApySet(bps);
    }

    function setApyBps(bytes32 marketId, uint16 bps) external onlyOwner {
        if (bps > 10_000) revert InvalidApy();
        apyBps[marketId] = bps;
        emit ApySet(marketId, bps);
    }

    function getLenderApyBps(bytes32 marketId) external view returns (uint16) {
        uint16 configured = apyBps[marketId];
        return configured == 0 ? defaultApyBps : configured;
    }
}
