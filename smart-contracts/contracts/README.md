# Contracts

## Product stack (web + CRE)

Debt asset on Sepolia markets: **Circle USDC** (6 decimals).

Idle lender cash lives in per-pair **ERC-4626 `PairVault`s** — not on the market contract.

| Contract | Role |
| -------- | ---- |
| [PairVault.sol](./markets/PairVault.sol) | **ERC-4626** idle USDC vault per pair; `deposit` / `redeem`; `totalAssets` includes owed principal + interest |
| [MarketLendingModule.sol](./markets/MarketLendingModule.sol) | Loans, LTV, `pullLiquidity` / `pushLiquidity`, liquidate; **`feeTo`** + **`liquidationFeeBps`** |
| [BorrowRateConfig.sol](./markets/BorrowRateConfig.sol) | Per-pair borrow APR |
| [StaticApySource.sol](./markets/StaticApySource.sol) | Lender display APY (UI only) |
| [CreLiquidationReceiver.sol](./markets/CreLiquidationReceiver.sol) | CRE `onReport` → `liquidate` |
| [ValuationOracle.sol](./ValuationOracle.sol) | DEX LP amounts × Chainlink USD |
| [V3Adapter.sol](./adapters/V3Adapter.sol) | Custody DEX V3 LP NFTs |
| [V4Adapter.sol](./adapters/V4Adapter.sol) | Custody DEX V4 LP NFTs |
| [interfaces/](./interfaces/) | Adapter, oracle, DEXLP, Chainlink |
| [libraries/](./libraries/) | PoolId, TickMath, LiquidityAmounts, FullMath, types |
| [mocks/](./mocks/) | Hardhat / unit tests only |

## Custody

- **Idle USDC** → **`PairVault`** (one per pair)
- **Outstanding debt** → tracked on market; repaid into vault on repay / liquidate
- **LP NFTs** → `V3Adapter` / `V4Adapter`

## Liquidation fee structure

After LP unwind + swaps, USDC recovery:

1. Debt (principal + interest) → **`pushLiquidity`** into the pair vault  
2. **`liquidationFeeBps`** of remaining surplus → **`feeTo`**  
3. Rest of surplus → borrower  

See [Markets contracts notes](./markets/README.md) and [Project Overview](../../docs/Project_Overview.pdf).

Valuation: `getPositionValueUsd` uses pool amounts × Chainlink (1e8 USD). See [Contract Architecture](../../docs/Smart_Contract_Architecture.pdf).
