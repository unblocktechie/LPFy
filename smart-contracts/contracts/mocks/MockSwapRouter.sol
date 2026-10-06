// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/IUniswapV3.sol";

/// @notice Test swap router: pays `amountOutMinimum` of tokenOut (must be pre-funded).
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountOutMinimum;
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
