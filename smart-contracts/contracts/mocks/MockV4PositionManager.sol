// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal mock of Uniswap V4 PositionManager for liquidation unit tests.
/// @dev Supports mint + modifyLiquidities(DECREASE_LIQUIDITY + TAKE_PAIR).
contract MockV4PositionManager is ERC721 {
    using SafeERC20 for IERC20;

    uint256 internal constant DECREASE_LIQUIDITY = 0x01;
    uint256 internal constant TAKE_PAIR = 0x11;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct Position {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    mapping(uint256 => Position) private _positions;
    uint256 public nextId = 1;

    error BadActions();
    error BadParams();
    error InsufficientLiquidity();

    constructor() ERC721("Mock Uni V4 Positions", "MUNI-V4") {}

    function mintPosition(
        address to,
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external returns (uint256 tokenId) {
        tokenId = nextId++;
        _positions[tokenId] = Position({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity,
            tokensOwed0: 0,
            tokensOwed1: 0
        });
        _mint(to, tokenId);
    }

    function setTokensOwed(uint256 tokenId, uint128 amount0, uint128 amount1) external {
        Position storage p = _positions[tokenId];
        p.tokensOwed0 = amount0;
        p.tokensOwed1 = amount1;
    }

    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory poolKey, uint256 info)
    {
        Position memory p = _positions[tokenId];
        poolKey = PoolKey({
            currency0: p.currency0,
            currency1: p.currency1,
            fee: p.fee,
            tickSpacing: p.tickSpacing,
            hooks: p.hooks
        });
        // Pack like V4 PositionInfo: [tickUpper << 32][tickLower << 8][subscriber]
        info = (uint256(uint24(p.tickUpper)) << 32) | (uint256(uint24(p.tickLower)) << 8);
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return _positions[tokenId].liquidity;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external payable {
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        if (actions.length < 2 || params.length < 2) revert BadActions();
        if (uint8(actions[0]) != DECREASE_LIQUIDITY || uint8(actions[1]) != TAKE_PAIR) {
            revert BadActions();
        }

        (uint256 tokenId, uint256 liquidityDelta,,,) =
            abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
        (address currency0, address currency1, address recipient) =
            abi.decode(params[1], (address, address, address));
        if (recipient == address(0)) revert BadParams();

        Position storage p = _positions[tokenId];
        if (liquidityDelta > p.liquidity) revert InsufficientLiquidity();
        p.liquidity -= uint128(liquidityDelta);

        uint256 amount0 = p.tokensOwed0;
        uint256 amount1 = p.tokensOwed1;
        p.tokensOwed0 = 0;
        p.tokensOwed1 = 0;

        if (amount0 > 0) {
            if (currency0 == address(0)) {
                (bool ok,) = recipient.call{value: amount0}("");
                require(ok, "eth0");
            } else {
                IERC20(currency0).safeTransfer(recipient, amount0);
            }
        }
        if (amount1 > 0) {
            if (currency1 == address(0)) {
                (bool ok,) = recipient.call{value: amount1}("");
                require(ok, "eth1");
            } else {
                IERC20(currency1).safeTransfer(recipient, amount1);
            }
        }
    }

    receive() external payable {}
}
