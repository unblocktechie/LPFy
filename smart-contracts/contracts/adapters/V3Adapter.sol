// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LendingTypes} from "../libraries/LendingTypes.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {PoolId} from "../libraries/PoolId.sol";
import {IPositionAdapter} from "../interfaces/IPositionAdapter.sol";
import {
    INonfungiblePositionManager,
    IUniswapV3Factory,
    IUniswapV3Pool
} from "../interfaces/IUniswapV3.sol";

/// @notice Holds Uniswap V3 LP NFTs and exposes position meta / amounts
contract V3Adapter is IERC721Receiver, Ownable {
    INonfungiblePositionManager public immutable npm;
    IUniswapV3Factory public immutable factory;
    address public lendingModule;

    mapping(uint256 => bool) private _held;

    event LendingModuleSet(address indexed module);
    event Deposited(uint256 indexed tokenId, address indexed from);
    event Withdrawn(uint256 indexed tokenId, address indexed to);

    error OnlyLendingModule();
    error NotHeld(uint256 tokenId);
    error AlreadyHeld(uint256 tokenId);
    error PoolNotFound();
    error ZeroAddress();

    modifier onlyLendingModule() {
        if (msg.sender != lendingModule) revert OnlyLendingModule();
        _;
    }

    constructor(address npm_, address factory_, address initialOwner) Ownable(initialOwner) {
        npm = INonfungiblePositionManager(npm_);
        factory = IUniswapV3Factory(factory_);
    }

    function setLendingModule(address module) external onlyOwner {
        lendingModule = module;
        emit LendingModuleSet(module);
    }

    function protocolVersion() external pure returns (LendingTypes.ProtocolVersion) {
        return LendingTypes.ProtocolVersion.V3;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function deposit(address from, uint256 tokenId) external onlyLendingModule {
        if (_held[tokenId]) revert AlreadyHeld(tokenId);
        npm.safeTransferFrom(from, address(this), tokenId);
        _held[tokenId] = true;
        emit Deposited(tokenId, from);
    }

    function withdraw(address to, uint256 tokenId) external onlyLendingModule {
        if (!_held[tokenId]) revert NotHeld(tokenId);
        _held[tokenId] = false;
        npm.safeTransferFrom(address(this), to, tokenId);
        emit Withdrawn(tokenId, to);
    }

    /// @inheritdoc IPositionAdapter
    function owns(uint256 tokenId) external view returns (bool) {
        return _held[tokenId];
    }

    function getPositionMeta(uint256 tokenId)
        external
        view
        returns (
            address token0,
            address token1,
            bytes32 poolId,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        )
    {
        uint24 fee;
        (,, token0, token1, fee, tickLower, tickUpper, liquidity,,,,) = npm.positions(tokenId);
        poolId = PoolId.v3PoolId(token0, token1, fee);
    }

}
