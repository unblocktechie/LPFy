// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LendingTypes} from "../libraries/LendingTypes.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {PoolId} from "../libraries/PoolId.sol";
import {IPositionAdapter} from "../interfaces/IPositionAdapter.sol";
import {IV4PositionManager, IV4StateView, IWETH9} from "../interfaces/IUniswapV4.sol";

/// @notice Holds Uniswap V4 LP NFTs and exposes position meta / amounts.
/// @dev When `positionManager` is address(0), falls back to owner `registerPosition` (unit tests).
contract V4Adapter is IERC721Receiver, Ownable {
    using SafeERC20 for IERC20;

    /// @dev Uniswap v4-periphery Actions
    uint256 private constant DECREASE_LIQUIDITY = 0x01;
    uint256 private constant TAKE_PAIR = 0x11;

    struct RegisteredPosition {
        address token0;
        address token1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        bool held;
        bool exists;
    }

    IV4PositionManager public immutable positionManager;
    IV4StateView public immutable stateView;
    address public lendingModule;
    /// @notice WETH used when a V4 pool currency is native (address(0)).
    address public weth;

    mapping(uint256 => bool) private _held;
    mapping(uint256 => RegisteredPosition) public registered;

    event LendingModuleSet(address indexed module);
    event WethSet(address indexed weth);
    event PositionRegistered(uint256 indexed tokenId);
    event Deposited(uint256 indexed tokenId, address indexed from);
    event Withdrawn(uint256 indexed tokenId, address indexed to);

    error OnlyLendingModule();
    error NotHeld(uint256 tokenId);
    error AlreadyHeld(uint256 tokenId);
    error NotRegistered(uint256 tokenId);
    error InvalidPosition();
    error ZeroAddress();
    error WethNotSet();

    modifier onlyLendingModule() {
        if (msg.sender != lendingModule) revert OnlyLendingModule();
        _;
    }

    constructor(address positionManager_, address stateView_, address initialOwner) Ownable(initialOwner) {
        positionManager = IV4PositionManager(positionManager_);
        stateView = IV4StateView(stateView_);
    }

    receive() external payable {}

    function setLendingModule(address module) external onlyOwner {
        lendingModule = module;
        emit LendingModuleSet(module);
    }

    function setWeth(address weth_) external onlyOwner {
        weth = weth_;
        emit WethSet(weth_);
    }

    /// @notice Test/bootstrap path when PositionManager is not wired
    function registerPosition(
        uint256 tokenId,
        address token0,
        address token1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external onlyOwner {
        require(address(positionManager) == address(0), "live");
        require(!_held[tokenId] && !registered[tokenId].held, "held");
        registered[tokenId] = RegisteredPosition({
            token0: token0,
            token1: token1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity,
            tokensOwed0: 0,
            tokensOwed1: 0,
            held: false,
            exists: true
        });
        emit PositionRegistered(tokenId);
    }

    function syncLiquidity(uint256 tokenId, uint128 liquidity) external onlyOwner {
        require(address(positionManager) == address(0), "live");
        registered[tokenId].liquidity = liquidity;
    }

    /// @notice Seed collectable amounts for the registerPosition (no-PM) test path.
    function setTokensOwed(uint256 tokenId, uint128 amount0, uint128 amount1) external onlyOwner {
        require(address(positionManager) == address(0), "live");
        RegisteredPosition storage p = registered[tokenId];
        if (!p.exists) revert NotRegistered(tokenId);
        p.tokensOwed0 = amount0;
        p.tokensOwed1 = amount1;
    }

    function protocolVersion() external pure returns (LendingTypes.ProtocolVersion) {
        return LendingTypes.ProtocolVersion.V4;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function deposit(address from, uint256 tokenId) external onlyLendingModule {
        if (_held[tokenId] || registered[tokenId].held) revert AlreadyHeld(tokenId);

        if (address(positionManager) != address(0)) {
            positionManager.safeTransferFrom(from, address(this), tokenId);
            _held[tokenId] = true;
        } else {
            RegisteredPosition storage p = registered[tokenId];
            if (!p.exists) revert NotRegistered(tokenId);
            p.held = true;
            _held[tokenId] = true;
        }
        emit Deposited(tokenId, from);
    }

    function withdraw(address to, uint256 tokenId) external onlyLendingModule {
        if (!_held[tokenId] && !registered[tokenId].held) revert NotHeld(tokenId);

        if (address(positionManager) != address(0)) {
            _held[tokenId] = false;
            positionManager.safeTransferFrom(address(this), to, tokenId);
        } else {
            RegisteredPosition storage p = registered[tokenId];
            if (!p.held) revert NotHeld(tokenId);
            p.held = false;
            _held[tokenId] = false;
        }
        emit Withdrawn(tokenId, to);
    }

    /// @inheritdoc IPositionAdapter
    /// @dev Live: PositionManager.modifyLiquidities(DECREASE_LIQUIDITY + TAKE_PAIR).
    ///      Native currency (address(0)) is wrapped to `weth` before transfer.
    function owns(uint256 tokenId) external view returns (bool) {
        return _held[tokenId] || registered[tokenId].held;
    }

    /// @dev PositionInfo packing: [200-bit poolId][24-bit tickUpper][24-bit tickLower][8-bit subscriber]
}
