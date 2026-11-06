# Contracts

## Product stack (Uniswap LP NFT lending + CRE)

Debt asset on Sepolia markets: **Circle USDC** (6 decimals).

**Uniswap integration (on-chain AMM only):** V3 NonfungiblePositionManager / Factory / Pool · V4 PositionManager / StateView · SwapRouter02 for liquidation. No Uniswap SDK or Trading API.

Idle lender cash lives in per-pair **ERC-4626 `PairVault`s** — not on the market contract.

| Contract | Role |
| -------- | ---- |
| [V3Adapter.sol](./adapters/V3Adapter.sol) | Custody / value / unwind **Uniswap V3** LP NFTs (NPM) |
| [V4Adapter.sol](./adapters/V4Adapter.sol) | Custody / value / unwind **Uniswap V4** LP NFTs (PositionManager + StateView) |
| [IUniswapV3.sol](./interfaces/IUniswapV3.sol) / [IUniswapV4.sol](./interfaces/IUniswapV4.sol) | Minimal Uniswap periphery surfaces |
| [MarketLendingModule.sol](./markets/MarketLendingModule.sol) | Loans, LTV, `pullLiquidity` / `pushLiquidity`, liquidate + `_swapToUsdc` (SwapRouter02); **`feeTo`** + **`liquidationFeeBps`** |
| [FeeFallbackSwapRouter.sol](./markets/FeeFallbackSwapRouter.sol) | Fee-tier retries when V4 LP fee ≠ liquid V3 pool |
| [PairVault.sol](./markets/PairVault.sol) | **ERC-4626** idle USDC vault per pair |
| [BorrowRateConfig.sol](./markets/BorrowRateConfig.sol) | Per-pair borrow APR |
| [StaticApySource.sol](./markets/StaticApySource.sol) | Lender display APY (UI only) |
| [CreLiquidationReceiver.sol](./markets/CreLiquidationReceiver.sol) | CRE `onReport` → `liquidate` |
| [ValuationOracle.sol](./ValuationOracle.sol) | Uniswap LP amounts × Chainlink USD |
| [interfaces/](./interfaces/) | Adapter, oracle, Uniswap, Chainlink |
| [libraries/](./libraries/) | PoolId, TickMath, LiquidityAmounts, FullMath, types |
| [mocks/](./mocks/) | Hardhat / unit tests only |

## Custody

- **Idle USDC** → **`PairVault`** (one per pair)
- **Outstanding debt** → tracked on market; repaid into vault on repay / liquidate
- **Uniswap LP NFTs** → `V3Adapter` / `V4Adapter`

## Liquidation fee structure

After Uniswap LP unwind + SwapRouter02 swaps, USDC recovery:

1. Debt (principal + interest) → **`pushLiquidity`** into the pair vault  
2. **`liquidationFeeBps`** of remaining surplus → **`feeTo`**  
3. Rest of surplus → borrower  

See [Markets contracts notes](./markets/README.md), [Project Overview](../../docs/Project_Overview.pdf), and [root Uniswap reviewer map](../../README.md#uniswap-integration-reviewer-map).

Valuation: `getPositionValueUsd` uses Uniswap pool amounts × Chainlink (1e8 USD). See [Contract Architecture](../../docs/Smart_Contract_Architecture.pdf).
