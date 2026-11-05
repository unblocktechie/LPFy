// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IBorrowRateConfig} from "./interfaces/IBorrowRateConfig.sol";
import {PairId} from "./libraries/PairId.sol";

/// @notice Static per-pair borrow APR. Configure pairs per network via setPair.
contract BorrowRateConfig is IBorrowRateConfig, Ownable {
    mapping(bytes32 => uint16) public borrowAprBps;
    mapping(bytes32 => bool) public supported;

    event PairConfigured(bytes32 indexed pairId, address tokenA, address tokenB, uint16 aprBps, bool enabled);

    error InvalidApr();
    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {
        // Pairs are network-specific — configure via setPair (see deploy scripts).
    }

    function getBorrowAprBps(bytes32 pairId) external view returns (uint16) {
        return borrowAprBps[pairId];
    }

    function isPairSupported(bytes32 pairId) external view returns (bool) {
        return supported[pairId];
    }

    function pairIdOf(address tokenA, address tokenB) external pure returns (bytes32) {
        return PairId.id(tokenA, tokenB);
    }

}
