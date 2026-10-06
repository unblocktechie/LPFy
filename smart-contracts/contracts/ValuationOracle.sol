// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {LendingTypes} from "./libraries/LendingTypes.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {FullMath} from "./libraries/FullMath.sol";
import {IPositionAdapter} from "./interfaces/IPositionAdapter.sol";
import {IValuationOracle} from "./interfaces/IValuationOracle.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @notice Values LP NFTs for lending: Uniswap pool amounts × live Chainlink USD.
/// @dev Debt conversion uses the debt token's Chainlink price and ERC-20 decimals
///      (USDC/USDT are 6). There is no 1:1 mock-stable peg.
contract ValuationOracle is IValuationOracle, Ownable {
    uint256 public constant PRICE_SCALE = 1e8;
    uint256 public maxPriceAge = 1 hours;
    /// @notice Max allowed divergence between pool price and Chainlink-implied price (bps). 0 = disable.
    uint16 public maxPoolDeviationBps; // 0 by default (enable on mainnet, e.g. 500–1000)

    mapping(address => AggregatorV3Interface) public feeds;
    /// @notice Per-token heartbeat override. 0 = use `maxPriceAge`. Stablecoin feeds often need 24h.
    mapping(address => uint256) public tokenMaxPriceAge;
    mapping(LendingTypes.ProtocolVersion => IPositionAdapter) public adapters;

    event FeedSet(address indexed token, address indexed feed);
    event AdapterSet(LendingTypes.ProtocolVersion version, address indexed adapter);
    event MaxPriceAgeSet(uint256 age);
    event TokenMaxPriceAgeSet(address indexed token, uint256 age);
    event MaxPoolDeviationSet(uint16 bps);

    error FeedNotSet(address token);
    error StalePrice(address token);
    error InvalidPrice(address token);
    error AdapterNotSet();
    error PoolPriceDeviation();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setFeed(address token, address feed) external onlyOwner {
        feeds[token] = AggregatorV3Interface(feed);
        emit FeedSet(token, feed);
    }

    function setAdapter(LendingTypes.ProtocolVersion version, address adapter) external onlyOwner {
        adapters[version] = IPositionAdapter(adapter);
        emit AdapterSet(version, adapter);
    }

    function setMaxPriceAge(uint256 age) external onlyOwner {
        maxPriceAge = age;
        emit MaxPriceAgeSet(age);
    }

    function setTokenMaxPriceAge(address token, uint256 age) external onlyOwner {
        tokenMaxPriceAge[token] = age;
        emit TokenMaxPriceAgeSet(token, age);
    }

    function setMaxPoolDeviationBps(uint16 bps) external onlyOwner {
        require(bps <= 10_000, "bps");
        maxPoolDeviationBps = bps;
        emit MaxPoolDeviationSet(bps);
    }

    function getTokenPriceUsd(address token) public view returns (uint256 priceUsd) {
        AggregatorV3Interface feed = feeds[token];
        if (address(feed) == address(0)) revert FeedNotSet(token);

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(token);
        if (answeredInRound < roundId) revert StalePrice(token);
        uint256 age = tokenMaxPriceAge[token];
        if (age == 0) age = maxPriceAge;
        if (block.timestamp - updatedAt > age) revert StalePrice(token);

        uint8 feedDecimals = feed.decimals();
        priceUsd = uint256(answer);
        if (feedDecimals < 8) {
            priceUsd = priceUsd * (10 ** (8 - feedDecimals));
        } else if (feedDecimals > 8) {
            priceUsd = priceUsd / (10 ** (feedDecimals - 8));
        }
    }

    /// @dev Native ETH (Uniswap V4 currency address(0)) has 18 decimals and no ERC20 metadata.
    function _tokenDecimals(address token) internal view returns (uint8) {
        if (token == address(0)) return 18;
        return IERC20Metadata(token).decimals();
    }

    function getPositionValueUsd(LendingTypes.ProtocolVersion version, uint256 tokenId)
        external
        view
        returns (uint256 valueUsd)
    {
        IPositionAdapter adapter = adapters[version];
        if (address(adapter) == address(0)) revert AdapterNotSet();

        (address token0, address token1,,,,) = adapter.getPositionMeta(tokenId);

        uint256 price0 = getTokenPriceUsd(token0);
        uint256 price1 = getTokenPriceUsd(token1);

        // Amounts from current pool price (matches Uniswap UI composition)
        uint160 poolSqrtPriceX96 = adapter.getPoolSqrtPriceX96(tokenId);

        // Optional sanity: pool price should not diverge too far from Chainlink
        if (maxPoolDeviationBps > 0) {
            uint160 oracleSqrtPriceX96 = _sqrtPriceFromUsdPrices(token0, token1, price0, price1);
            _requireSqrtPriceClose(poolSqrtPriceX96, oracleSqrtPriceX96, maxPoolDeviationBps);
        }

        (uint256 amount0, uint256 amount1) = adapter.getAmountsForValuation(tokenId, poolSqrtPriceX96);

        uint8 dec0 = _tokenDecimals(token0);
        uint8 dec1 = _tokenDecimals(token1);

        // USD value from Chainlink (real USD), not the pool's implied ETH price
        valueUsd = (amount0 * price0) / (10 ** dec0) + (amount1 * price1) / (10 ** dec1);
    }

    function convertUsdToDebtAsset(address debtAsset, uint256 valueUsd)
        external
        view
        returns (uint256 amount)
    {
        uint256 debtPrice = getTokenPriceUsd(debtAsset);
        uint8 debtDecimals = _tokenDecimals(debtAsset);
        // valueUsd and debtPrice are 1e8 USD. Result is debt-token units (e.g. 6-dec USDC).
        amount = (valueUsd * (10 ** debtDecimals)) / debtPrice;
    }

    function _requireSqrtPriceClose(uint160 a, uint160 b, uint16 maxBps) internal pure {
        if (a == 0 || b == 0) revert PoolPriceDeviation();
        uint256 hi = uint256(a) > uint256(b) ? uint256(a) : uint256(b);
        uint256 lo = uint256(a) > uint256(b) ? uint256(b) : uint256(a);
        // compare squares roughly via ratio of sqrt prices: |a-b|/b <= maxBps/10000
        uint256 diffBps = ((hi - lo) * 10_000) / lo;
        if (diffBps > maxBps) revert PoolPriceDeviation();
    }

    function _sqrtPriceFromUsdPrices(address token0, address token1, uint256 price0Usd, uint256 price1Usd)
        internal
        view
        returns (uint160)
    {
        uint8 dec0 = _tokenDecimals(token0);
        uint8 dec1 = _tokenDecimals(token1);
        require(price1Usd > 0, "den");

        uint256 priceX96 = FullMath.mulDiv(price0Usd, 10 ** uint256(dec1), price1Usd);
        priceX96 = FullMath.mulDiv(priceX96, uint256(1) << 96, 10 ** uint256(dec0));

        uint256 sqrtRatio = _sqrt(FullMath.mulDiv(priceX96, uint256(1) << 96, 1));
        require(sqrtRatio <= type(uint160).max, "overflow");

        if (sqrtRatio < TickMath.getSqrtRatioAtTick(TickMath.MIN_TICK)) {
            return TickMath.getSqrtRatioAtTick(TickMath.MIN_TICK);
        }
        if (sqrtRatio >= TickMath.getSqrtRatioAtTick(TickMath.MAX_TICK)) {
            return TickMath.getSqrtRatioAtTick(TickMath.MAX_TICK - 1);
        }
        return uint160(sqrtRatio);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }
}
