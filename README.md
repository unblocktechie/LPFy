# LPFY Markets

Two-sided lending against **DEX LP NFTs**. Lenders provide USDC liquidity through isolated per-pair **ERC-4626 `PairVault`s**, while borrowers use supported LP positions as collateral and borrow against their on-chain USD value.

The smart-contract package contains the lending engine, pair vaults, collateral adapters, valuation oracle, liquidation logic, deployment tooling, and tests.

## Features

### ERC-4626 PairVaults

- One `PairVault` per supported market pair.
- Standard ERC-4626 `deposit`, `mint`, `withdraw`, and `redeem` flows.
- Market-controlled liquidity pull/push accounting for borrowing, repayment, and liquidation recovery.
- Per-pair utilization limits.
- Configurable borrow APR through `BorrowRateConfig`.
- Lender-facing APY source through `StaticApySource`.

### LP-Backed Borrowing

- DEX LP NFT collateral support through V3 and V4 position adapters.
- Pair-aware collateral validation.
- USD valuation through `ValuationOracle` and Chainlink-compatible price feeds.
- LTV-based borrowing controls.
- Interest accrual, additional borrowing, repayment, and collateral withdrawal flows.

### Liquidation

- Configurable liquidation threshold and slippage controls.
- `previewLiquidation(loanId)` for liquidation inspection.
- LP unwind through the configured position adapter.
- Non-USDC asset conversion through the configured swap router.
- Debt recovery back into the relevant pair vault.
- Configurable protocol liquidation fee and independent `feeTo` recipient.
- `CreLiquidationReceiver` contract for authorized report-based liquidation execution.

## Smart Contracts

| Contract | Responsibility |
| --- | --- |
| `MarketLendingModule` | Loan lifecycle, LTV checks, interest, vault liquidity, repayment, liquidation, fees |
| `PairVault` | ERC-4626 lender liquidity and pair-level vault accounting |
| `PairVaultFactory` | Pair-vault deployment and registry |
| `ValuationOracle` | LP-position valuation using token amounts and price feeds |
| `V3Adapter` | V3 LP NFT custody and unwind integration |
| `V4Adapter` | V4 LP position custody and unwind integration |
| `BorrowRateConfig` | Per-pair borrow-rate configuration |
| `StaticApySource` | Per-pair lender APY source |
| `CreLiquidationReceiver` | Authorized report receiver for liquidation execution |

## Technology Stack

| Area | Technologies |
| --- | --- |
| Smart contracts | Solidity `0.8.24`, OpenZeppelin `5.0.2` |
| Development | Hardhat, Ethers v6, Node.js |
| Debt / vaults | USDC + per-pair ERC-4626 `PairVault` |
| Valuation | LP math + Chainlink AggregatorV3-compatible feeds |
| DEX integration | V3 / V4 position adapters |
| Swaps | SwapRouter02-compatible router integration |

## Contract Architecture

```text
Lender
  │
  └── deposit / redeem
          │
          ▼
     PairVault (ERC-4626)
          │
     pull / push liquidity
          │
          ▼
 MarketLendingModule
      │     │      │
      │     │      └── BorrowRateConfig / StaticApySource
      │     └───────── ValuationOracle → price feeds
      └─────────────── V3Adapter / V4Adapter → LP positions
```

## Project Structure

```text
.
├── README.md
└── smart-contracts/
    ├── contracts/
    │   ├── MarketLendingModule.sol
    │   ├── ValuationOracle.sol
    │   ├── adapters/
    │   │   ├── V3Adapter.sol
    │   │   └── V4Adapter.sol
    │   ├── interfaces/
    │   ├── libraries/
    │   ├── markets/
    │   │   ├── PairVault.sol
    │   │   ├── PairVaultFactory.sol
    │   │   ├── BorrowRateConfig.sol
    │   │   ├── StaticApySource.sol
    │   │   └── CreLiquidationReceiver.sol
    │   └── mocks/
    ├── scripts/
    ├── test/
    ├── hardhat.config.js
    └── package.json
```

## Prerequisites

- **Node.js** 18+ (20+ recommended)
- **npm**
- An RPC endpoint for network deployments
- A funded deployer key when broadcasting transactions

## Installation

```bash
cd smart-contracts
cp .env.example .env
npm ci
```

## Compile and Test

```bash
npm run compile
npm test
```

Hardhat commands can also be run directly:

```bash
npx hardhat compile
npx hardhat test
```

## Environment Configuration

Use `smart-contracts/.env` for private keys and RPC endpoints. The checked-in `.env.example` documents the expected variable names without committing secrets.

## Security

Do not commit private keys, seed phrases, funded account credentials, or production RPC secrets. Review network addresses and deployment parameters before broadcasting transactions.
