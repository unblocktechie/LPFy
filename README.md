# LPFY Markets

LPFY Markets is an on-chain lending protocol built around isolated **ERC-4626 PairVaults**. Each supported market pair can maintain its own USDC liquidity vault, borrow-rate configuration, and lender-facing APY source while sharing a common Hardhat development environment.

## Core Contracts

| Contract | Responsibility |
| --- | --- |
| `PairVault` | ERC-4626 vault that holds liquidity for a configured market pair |
| `PairVaultFactory` | Creates and tracks pair-specific vaults |
| `MarketsConfig` | Shared market configuration primitives |
| `BorrowRateConfig` | Stores pair-level borrowing rates |
| `StaticApySource` | Provides lender-facing APY values |
| `MockERC20` | ERC-20 test asset used by the contract test environment |

Supporting interfaces and pair-ID helpers keep vault accounting and rate configuration decoupled from individual implementations.

## ERC-4626 PairVaults

`PairVault` uses the ERC-4626 tokenized-vault standard for lender deposits and shares. Liquidity is isolated per configured token pair, allowing each market to maintain its own vault accounting rather than pooling all lending capital into a single contract.

The vault layer exposes standard ERC-4626 operations such as:

- `deposit`
- `mint`
- `withdraw`
- `redeem`

Pair-specific accounting interfaces are defined under `smart-contracts/contracts/interfaces/`.

## Rate Configuration

Borrow rates are represented separately from vault balances through `BorrowRateConfig`. Lender-facing APY data is exposed through `StaticApySource` and the `IApySource` interface, keeping display-rate configuration independent from vault custody.

## Technology Stack

| Area | Technologies |
| --- | --- |
| Smart contracts | Solidity `0.8.24` |
| Development | Hardhat `2.x`, Hardhat Toolbox |
| Contract libraries | OpenZeppelin Contracts `5.0.2` |
| JavaScript tooling | Node.js, npm, Ethers v6 |
| Vault standard | ERC-4626 |

## Project Structure

```text
.
├── README.md
└── smart-contracts/
    ├── contracts/
    │   ├── markets/
    │   │   ├── PairVault.sol
    │   │   ├── PairVaultFactory.sol
    │   │   ├── MarketsConfig.sol
    │   │   ├── BorrowRateConfig.sol
    │   │   ├── StaticApySource.sol
    │   │   ├── interfaces/
    │   │   └── libraries/
    │   ├── interfaces/
    │   └── mocks/
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
