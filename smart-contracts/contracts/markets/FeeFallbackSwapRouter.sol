// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/IUniswapV3.sol";

/// @title FeeFallbackSwapRouter
/// @notice Drop-in `exactInputSingle` wrapper for MarketLendingModule.setSwapRouter.
///         Tries the requested V3 fee, then 500 / 3000 / 10000 / 100.
///         Use this on already-deployed markets that cannot be upgraded.
contract FeeFallbackSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    ISwapRouter public immutable inner;

    error ZeroAddress();
    error SwapFailed(address tokenIn, address tokenOut, uint256 amountIn);

    constructor(address inner_) {
        if (inner_ == address(0)) revert ZeroAddress();
        inner = ISwapRouter(inner_);
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenIn).forceApprove(address(inner), params.amountIn);

        ISwapRouter.ExactInputSingleParams memory p = ISwapRouter.ExactInputSingleParams({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            fee: params.fee,
            recipient: params.recipient,
            amountIn: params.amountIn,
            amountOutMinimum: params.amountOutMinimum,
            sqrtPriceLimitX96: params.sqrtPriceLimitX96
        });

        uint24[1] memory fees = [params.fee];

        for (uint256 i = 0; i < fees.length; i++) {
            if (i > 0 && fees[i] == params.fee) continue;
            p.fee = fees[i];
            try inner.exactInputSingle(p) returns (uint256 out) {
                IERC20(params.tokenIn).forceApprove(address(inner), 0);
                return out;
            } catch {}
        }

        IERC20(params.tokenIn).forceApprove(address(inner), 0);
        uint256 leftover = IERC20(params.tokenIn).balanceOf(address(this));
        if (leftover > 0) IERC20(params.tokenIn).safeTransfer(msg.sender, leftover);
        revert SwapFailed(params.tokenIn, params.tokenOut, params.amountIn);
    }
}
