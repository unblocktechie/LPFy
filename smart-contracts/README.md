# Smart Contracts — LPFY Markets

Solidity contracts for the pair-based liquidity layer used by LPFY Markets. The package is built with Hardhat and introduces ERC-4626 vaults together with pair configuration, borrow-rate configuration, and lender APY configuration.

## Core contracts

| Contract | Purpose |
|---|---|
| `PairVault` | ERC-4626 vault that holds the debt asset for a single market pair and accounts for assets deployed by the market. |
| `PairVaultFactory` | Deploys one `PairVault` per pair identifier and registers it with the market registry. |
| `BorrowRateConfig` | Stores owner-configured borrow APR values and pair support flags. |
| `StaticApySource` | Provides a configurable lender APY per market with a default fallback value. |
| `MarketsConfig` | Shared market constants and protocol defaults. |
| `PairId` | Produces deterministic identifiers for token pairs. |

## PairVault model

`PairVault` follows ERC-4626 for lender shares. Idle assets remain inside the vault, while market accounting can be included in `totalAssets()` through `IMarketVaultAccounting`.

```text
totalAssets = idle vault balance + assets owed by the market
```

Liquidity movement is restricted to the configured market:

- `pullLiquidity` transfers idle assets from the vault to the market-selected recipient.
- `pushLiquidity` returns assets from the market to the vault.
- `maxWithdraw` and `maxRedeem` are limited by currently idle liquidity.

## Setup

```bash
cd smart-contracts
cp .env.example .env
npm ci
npm run compile
```

Configure RPC endpoints and deployment credentials in `.env` using `.env.example` as the reference.

## Project structure

```text
contracts/
└── markets/
    ├── PairVault.sol
    ├── PairVaultFactory.sol
    ├── BorrowRateConfig.sol
    ├── StaticApySource.sol
    ├── MarketsConfig.sol
    ├── interfaces/
    └── libraries/
```

## Commands

```bash
npm run compile     # Compile Solidity contracts
npm test            # Run the Hardhat test suite
```

The Hardhat configuration centralizes compiler settings and network access so contract development and deployment scripts can share the same environment.
