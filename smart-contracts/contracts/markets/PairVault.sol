// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPairVault} from "../interfaces/IPairVault.sol";
import {IMarketVaultAccounting} from "../interfaces/IMarketVaultAccounting.sol";

/// @title PairVault — ERC-4626 USDC vault for one lending pair
/// @notice Idle USDC sits here. Market pulls on borrow and pushes on repay.
///         `totalAssets` = idle balance + principal/interest owed by the market.
contract PairVault is ERC4626, IPairVault {
    using SafeERC20 for IERC20;

    address public immutable override market;
    bytes32 public immutable override pairId;

    error NotMarket(address caller);
    error ZeroAddress();
    error InsufficientIdle(uint256 requested, uint256 idle);

    modifier onlyMarket() {
        if (msg.sender != market) revert NotMarket(msg.sender);
        _;
    }

    constructor(
        IERC20 asset_,
        address market_,
        bytes32 pairId_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (market_ == address(0)) revert ZeroAddress();
        market = market_;
        pairId = pairId_;
    }

    /// @inheritdoc IPairVault
    function idleAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @inheritdoc ERC4626
    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        return idleAssets() + IMarketVaultAccounting(market).assetsOwedToVault(pairId);
    }

    /// @dev Lenders can only withdraw idle cash, not assets currently lent out.
    function maxWithdraw(address owner_) public view override(ERC4626, IERC4626) returns (uint256) {
        uint256 ownerAssets = _convertToAssets(balanceOf(owner_), Math.Rounding.Floor);
        uint256 idle = idleAssets();
        return ownerAssets < idle ? ownerAssets : idle;
    }

    function maxRedeem(address owner_) public view override(ERC4626, IERC4626) returns (uint256) {
        return _convertToShares(maxWithdraw(owner_), Math.Rounding.Floor);
    }

    /// @inheritdoc IPairVault
    function pullLiquidity(uint256 assets, address to) external override onlyMarket {
        if (assets == 0) return;
        uint256 idle = idleAssets();
        if (assets > idle) revert InsufficientIdle(assets, idle);
        IERC20(asset()).safeTransfer(to, assets);
    }

    /// @inheritdoc IPairVault
    function pushLiquidity(uint256 assets) external override onlyMarket {
        if (assets == 0) return;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
    }
}
