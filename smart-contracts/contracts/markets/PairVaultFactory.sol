// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PairVault} from "./PairVault.sol";
import {IMarketVaultRegistry} from "../interfaces/IMarketVaultRegistry.sol";

/// @notice Deploys one PairVault per pairId and registers it on the market.
contract PairVaultFactory is Ownable {
    IERC20 public immutable asset;
    IMarketVaultRegistry public immutable market;

    mapping(bytes32 => address) public vaultOf;

    event VaultCreated(bytes32 indexed pairId, address indexed vault, string name, string symbol);

    error VaultExists(bytes32 pairId);
    error ZeroAddress();

    constructor(address initialOwner, address asset_, address market_) Ownable(initialOwner) {
        if (asset_ == address(0) || market_ == address(0)) revert ZeroAddress();
        asset = IERC20(asset_);
        market = IMarketVaultRegistry(market_);
    }

    function createVault(bytes32 pairId, string calldata name_, string calldata symbol_)
        external
        onlyOwner
        returns (address vault)
    {
        if (vaultOf[pairId] != address(0)) revert VaultExists(pairId);
        PairVault v = new PairVault(asset, address(market), pairId, name_, symbol_);
        vault = address(v);
        vaultOf[pairId] = vault;
        market.setVault(pairId, vault);
        emit VaultCreated(pairId, vault, name_, symbol_);
    }
}
