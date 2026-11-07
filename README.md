# LPFY Markets

**Uniswap-centric LP NFT lending.** Borrowers unlock Circle USDC against **Uniswap V3 and V4** concentrated-liquidity position NFTs without selling the LP. Lenders supply USDC into **isolated per-pair ERC-4626 `PairVault`s**. Collateral is valued on-chain (Uniswap LP amounts × **Chainlink USD**). Liquidations unwind the NFT through Uniswap adapters, swap non-USDC legs via **Uniswap SwapRouter02**, repay the vault, take a protocol fee to **`feeTo`**, and return remaining surplus to the borrower — callable by the market admin or a **Chainlink CRE** keeper.

**What we use from Uniswap:** AMM **v3** (NonfungiblePositionManager, Factory, Pool) · AMM **v4** (PositionManager, StateView) · **SwapRouter02** for liquidation swaps. Not used: Uniswap SDK, Trading API, CCA, or custom v4 hooks.

**Uniswap Foundation (ETHGlobal Mumbai):** see [`FEEDBACK.md`](./FEEDBACK.md) and submit the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback) with that file’s URL. Reviewer map below.

## Uniswap integration (reviewer map)

| Piece | Path | What to look at |
| ----- | ---- | --------------- |
| V3 LP custody + unwind | [`smart-contracts/contracts/adapters/V3Adapter.sol`](smart-contracts/contracts/adapters/V3Adapter.sol) | `deposit` / `withdraw`; `unwind` → NPM `decreaseLiquidity` + `collect`; pool `slot0` amounts |
| V4 LP custody + unwind | [`smart-contracts/contracts/adapters/V4Adapter.sol`](smart-contracts/contracts/adapters/V4Adapter.sol) | PositionManager custody; `modifyLiquidities` decrease + take-pair; native `address(0)` → WETH |
| Shared adapter API | [`smart-contracts/contracts/interfaces/IPositionAdapter.sol`](smart-contracts/contracts/interfaces/IPositionAdapter.sol) | Protocol-agnostic deposit / meta / unwind |
| V3 / V4 interfaces | [`IUniswapV3.sol`](smart-contracts/contracts/interfaces/IUniswapV3.sol), [`IUniswapV4.sol`](smart-contracts/contracts/interfaces/IUniswapV4.sol) | Minimal NPM / Factory / Pool / SwapRouter02 / PositionManager / StateView |
| Liquidation swaps | [`MarketLendingModule.sol`](smart-contracts/contracts/markets/MarketLendingModule.sol) `_swapToUsdc` | `SwapRouter02.exactInputSingle` with fee-tier fallback (`500/3000/10000/100`) |
| Fee-fallback router | [`FeeFallbackSwapRouter.sol`](smart-contracts/contracts/markets/FeeFallbackSwapRouter.sol) | Drop-in wrapper when LP fee ≠ liquid V3 pool (common for V4 fees) |
| Deployed addresses | [`smart-contracts/deployments/sepolia-markets.json`](smart-contracts/deployments/sepolia-markets.json) | Sepolia market, adapters, vaults, router wiring |

## Overview

| Surface | Role |
| ------- | ---- |
| **`smart-contracts/`** | Hardhat: Uniswap V3/V4 adapters, `MarketLendingModule`, **PairVault (ERC-4626)**, oracle, CRE receiver |
| **`web/`** | Markets (Uniswap V3/V4 rows), vault supply / borrow vs LP NFT, Assets; **Liquidate + Admin** for owner |
| **`cre/`** | Cron keeper → `needsUpkeep` → KeystoneForwarder → liquidate Uniswap-backed loans |
| **`docs/`** | Uniswap-first architecture HTML + setup guide |

**Debt asset (Sepolia):** [Circle Sepolia USDC](https://sepolia.etherscan.io/token/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) (6 decimals).

Addresses: [Sepolia markets deployment](smart-contracts/deployments/sepolia-markets.json) (full table at the bottom of this README).

> **Supply path:** lenders use **`PairVault.deposit` / `redeem`** (ERC-4626). Market `lendUsdc` / `withdrawLender` revert (`UsePairVault`).

## Features

### ERC-4626 PairVaults (lending)

- One **`PairVault` per pair** (USDC/WETH, USDC/USDT, USDC/WBTC) holds **idle USDC**.
- Lenders: standard ERC-4626 `deposit` / `mint` / `withdraw` / `redeem`.
- Borrow: market **`pullLiquidity`** from the vault → borrower.
- Repay / liquidation recovery: market **`pushLiquidity`** back into the vault.
- `totalAssets = idle vault USDC + principal + accrued interest` (share price rises with borrower interest).
- Withdrawals limited to **idle cash** (`maxWithdraw`).
- Utilization cap per pair (default **80%**).
- Per-pair **borrow APR** (`BorrowRateConfig`) and **lender display APY** (`StaticApySource` — UI only).

Deep dive: [Project Overview](docs/Project_Overview.pdf).

### Borrowing (Uniswap LP NFT collateral)

- Deposit a **Uniswap V3 or V4 LP NFT** as collateral (`V3Adapter` / `V4Adapter` hold the NFT).
- Borrow only from the vault matching the NFT’s underlying pair (e.g. USDC/WETH).
- Default **LTV 50%** (per-pair overrides via `setPairRiskParams`); live valuation via Uniswap LP amounts × Chainlink feeds.
- Accrue interest, borrow more (within LTV), repay / `repayAndWithdraw`, withdraw NFT when debt is zero.

### Liquidation + fee structure

- Threshold default **65%** of collateral value (must be ≥ LTV).
- **Live globals**: `defaultLtvBps` / `defaultLiquidationThresholdBps` apply when a pair has no override.
- `previewLiquidation(loanId)` dry-run; `liquidate(loanId)` for owner or CRE only.
- Flow: Uniswap adapter **unwind** → **SwapRouter02** → USDC → **push debt to PairVault** → protocol fee → borrower surplus.
- **Fee structure** (on `MarketLendingModule`):
  - `liquidationFeeBps` — % of **surplus** after vault is repaid (e.g. `1000` = **10%**)
  - `feeTo` — fee recipient (**independent of Ownable `owner`**)
  - Remainder of surplus → **borrower**; shortfall → no fee
  - Owner: `setLiquidationFeeBps` / `setFeeTo` (also set at redeploy via `LIQUIDATION_FEE_BPS` / `FEE_TO`)

### Chainlink CRE keeper

- `CreLiquidationReceiver` → KeystoneForwarder `onReport` → `liquidate`.
- CRE does not configure fees; fees are on the market.
- Local fallback: [local liquidation keeper script](smart-contracts/scripts/run-liquidation-keeper-local.js).

### Web

- Markets, pair detail (vault supply / borrow), Assets.
- **Liquidate** and **Admin** for market **owner** only.
- Wagmi / Viem; Sepolia network guard.

## Technology Stack

| Area | Technologies |
| ---- | ------------ |
| Uniswap | V3 NPM / Factory / Pool · V4 PositionManager / StateView · SwapRouter02 (on-chain; no SDK) |
| Smart contracts | Solidity `0.8.24`, Hardhat, OpenZeppelin `5.0.2` (ERC-4626), Ethers v6 |
| Debt / vaults | Circle USDC + per-pair `PairVault` |
| Valuation | Uniswap LP math × Chainlink AggregatorV3 |
| Automation | Chainlink CRE |
| Web | React 18, Vite 6, Wagmi 2, Viem 2, TypeScript |

## Project Architecture

```mermaid
flowchart TB
  subgraph users [Users]
    Lender[Lender wallet]
    Borrower[Borrower wallet]
    Admin[Market owner]
    FeeTo[feeTo wallet]
  end

  subgraph ui [Web]
    SPA[React / Vite SPA]
  end

  subgraph chain [EVM Sepolia]
    Market[MarketLendingModule]
    Vault[PairVault ERC-4626]
    V3[V3 adapter]
    V4[V4 adapter]
    Oracle[ValuationOracle]
    Rates[BorrowRateConfig]
    Apy[StaticApySource]
    Receiver[CreLiquidationReceiver]
    Router[SwapRouter02]
    USDC[Circle USDC]
    Uni[Uniswap V3 NPM / V4 PM]
    CL[Chainlink feeds]
  end

  subgraph cre [Chainlink CRE]
    Cron[Cron trigger]
    WF[liquidation-keeper]
    Fwd[KeystoneForwarder]
  end

  Lender -->|deposit / redeem| Vault
  Borrower --> SPA
  Admin --> SPA
  SPA --> Market
  SPA --> Vault

  Market -->|pull / push| Vault
  Vault --> USDC
  Market --> V3
  Market --> V4
  Market --> Oracle
  Market --> Rates
  Market --> Apy
  Market --> Router
  Market -->|fee on liquidate| FeeTo
  V3 --> Uni
  V4 --> Uni
  Oracle --> CL

  Cron --> WF
  WF -->|needsUpkeep| Receiver
  WF -->|writeReport| Fwd
  Fwd -->|onReport| Receiver
  Receiver -->|liquidate| Market
  Admin -->|liquidate| Market
```

### Where funds / NFTs live

| Asset | Custody |
| ----- | ------- |
| Idle Circle USDC (lender cash) | **`PairVault`** (per pair) |
| Outstanding principal + interest | Tracked on market; owed back to vault |
| Uniswap LP NFT (V3 / V4) | `V3Adapter` / `V4Adapter` |

### Liquidation path

```text
previewLiquidation(loanId)     → dry-run (anyone)
liquidate(loanId)              → owner or CRE only
  → Adapter.unwind             → empty NFT → borrower
  → SwapRouter02               → non-USDC → Circle USDC
  → pushLiquidity to PairVault → repay debt
  → feeTo                      ← liquidationFeeBps of surplus
  → borrower                   ← remaining surplus
```

## Project Structure

```text
.
├── README.md
├── FEEDBACK.md                          # Uniswap Foundation hackathon feedback
├── smart-contracts/                     # Hardhat package
│   ├── contracts/markets/
│   │   ├── MarketLendingModule.sol      # Loans, pull/push, feeTo, liquidationFeeBps
│   │   ├── PairVault.sol                # ERC-4626 idle USDC per pair
│   │   ├── CreLiquidationReceiver.sol
│   │   └── …
│   ├── scripts/                         # Deploy / redeploy (updates CRE + webEnv)
│   ├── deployments/sepolia-markets.json
│   └── package.json
├── web/                                 # React SPA (Vite)
├── cre/                                 # CRE liquidation-keeper
└── docs/
    ├── Project_Overview.pdf             # Uniswap LP lending overview
    ├── Smart_Contract_Architecture.pdf
    ├── Chainlink_CRE.pdf
    ├── DEMO_VIDEO_SCRIPT.md / .txt
    └── SETUP_AND_DEPLOY.md
```

## Prerequisites

- **Node.js** 18+ (20+ recommended), **npm**
- Sepolia ETH + deployer key (never commit)
- Optional CRE: [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation), [Bun](https://bun.sh) ≥ 1.2.21

Full walkthrough: [Setup & Deploy guide](docs/SETUP_AND_DEPLOY.md).

## Installation

### 1. Smart contracts

```bash
cd smart-contracts
cp .env.example .env   # PRIVATE_KEY + RPCs
npm install
npx hardhat compile
```

### 2. Web app

```bash
cd web
npm install
```

### 3. CRE (optional)

```bash
cd cre/liquidation-keeper
bun install
```

## Environment Configuration

| App | Env file | Notes |
| --- | -------- | ----- |
| Hardhat | [smart-contracts/.env](smart-contracts/.env.example) | `PRIVATE_KEY`, RPCs; optional `LIQUIDATION_FEE_BPS`, `FEE_TO`, `FUND_PER_PAIR` |
| Web | [web/.env](web/.env.example) | Paste `webEnv` from deployments JSON (includes `VITE_SEPOLIA_VAULT_*`) |
| CRE | [cre/.env](cre/.env.example) | `CRE_ETH_PRIVATE_KEY`, `SEPOLIA_RPC_URL` → `node cre/sync-rpc.js` |

### Web env (example — always prefer latest `webEnv`)

```env
VITE_NETWORK=sepolia
VITE_SEPOLIA_MARKET_MODULE=0x618a17C71b1D3922172E1b77D6e3D17704DE9f41
VITE_SEPOLIA_CRE_RECEIVER=0x32866b81408d0260259BC0109b9F0a300Cdca132
VITE_SEPOLIA_USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
VITE_SEPOLIA_VAULT_USDC_WETH=0xE47ABe4b88Fa2F47f4913710e8ecfBDE1205A5dc
VITE_SEPOLIA_VAULT_USDC_USDT=0x9cf1CF796147DD6c4Ff2f57E91F67fe14397d8eF
VITE_SEPOLIA_VAULT_USDC_WBTC=0xE374DEF41E1c63d54FFeB7B4a3fbA554574A4F84
# …plus oracle, adapters, rates, APY, USDT, WBTC — or run: npm run sync:addresses
```

## Running

```bash
# Web
cd web && npm run dev

# Compile / test
cd smart-contracts
npx hardhat compile
npx hardhat test

# Redeploy / full deploy
cd smart-contracts
npm run deploy:sepolia          # all contracts from scratch (hackathon)
# npm run redeploy:sepolia      # market+vaults only (reuse oracle/rates/APY)
npm run verify:sepolia
```

Then run `npm run sync:addresses` (from `smart-contracts/`) to refresh `web/.env` + README examples.

## User Flows

### Lender

1. Open a market pair → Supply.
2. Approve **Circle USDC** → **`PairVault.deposit`** (not `lendUsdc`).
3. Track vault shares on **Assets**.
4. Withdraw / redeem when the vault has **idle** cash.

### Borrower

1. Matching Uniswap V3/V4 pair → Borrow → approve LP NFT → `borrowWithCollateral`.
2. Manage on **Assets** (`repay`, `repayAndWithdraw`, borrow more).

### Liquidation

1. Market **owner** → **Liquidate** (or CRE `--broadcast`).
2. Uniswap unwind + SwapRouter02 → vault repaid → **`feeTo`** fee share → borrower surplus.

## Smart Contracts (markets)

| Contract | Responsibility |
| -------- | -------------- |
| `PairVault` | ERC-4626 idle USDC; share price includes assets owed |
| `MarketLendingModule` | Loans, LTV, pull/push, **`feeTo` / `liquidationFeeBps`**, liquidate |
| `V3Adapter` / `V4Adapter` | Uniswap V3/V4 LP NFT custody + unwind |
| `ValuationOracle` | Position USD |
| `BorrowRateConfig` | Borrow APR |
| `StaticApySource` | Lender display APY |
| `CreLiquidationReceiver` | CRE → `liquidate` |

| Param | Default |
| ----- | ------- |
| `defaultLtvBps` | 5000 (50%) |
| `defaultLiquidationThresholdBps` | 6500 (65%) |
| `liquidationSlippageBps` | 100 (1%) |
| `maxUtilizationBps` | 8000 (80%) |
| `liquidationFeeBps` | set at deploy / via `setLiquidationFeeBps` (e.g. 1000 = 10%) |

## Chainlink CRE

```bash
cd cre
cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings
cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings --broadcast
```

See [CRE README](cre/README.md).

## Security Considerations

- Never commit `.env` / private keys.
- Liquidation is **restricted** (owner + CRE).
- Fees go to **`feeTo`**, not necessarily the owner — set carefully.
- Oracle freshness depends on Chainlink feeds.
- **Not audited** — experimental on public networks.

## Related Docs

- [Project Overview](docs/Project_Overview.pdf) — **vaults + fee model**
- [Setup & Deploy guide](docs/SETUP_AND_DEPLOY.md)
- [Contract Architecture](docs/Smart_Contract_Architecture.pdf)
- [Chainlink & CRE](docs/Chainlink_CRE.pdf)
- [Smart contracts README](smart-contracts/README.md)
- [Markets contracts notes](smart-contracts/contracts/markets/README.md)
- [Web README](web/README.md)
- [CRE README](cre/README.md)
- [Docs index](docs/README.md)

## Deployed contracts (Sepolia)

Canonical file: [Sepolia markets deployment](smart-contracts/deployments/sepolia-markets.json). Setup: [Setup & Deploy guide](docs/SETUP_AND_DEPLOY.md).

| Key | Meaning |
| --- | ------- |
| `contracts.marketLendingModule` | Market (borrow / liquidate / fees) |
| `contracts.pairVaults` / `pairVaults` | Per-pair ERC-4626 vaults |
| `contracts.creLiquidationReceiver` | CRE consumer |
| `contracts.debtAsset` | Circle USDC |
| `webEnv` | Ready-to-paste Vite vars (incl. vaults) |

| Contract | Address |
| -------- | ------- |
| MarketLendingModule | `0x618a17C71b1D3922172E1b77D6e3D17704DE9f41` |
| ValuationOracle | `0x16E03515cf524B5D0D0db6E44F342ef0af7301e3` |
| V3Adapter | `0x48ee590E073f5ae2FDFCEA465e6281115308dDc9` |
| V4Adapter | `0x646DB0572422424947262fC3Bda2940f51504759` |
| BorrowRateConfig | `0x96ff2ce7B8AEfEadCAF460f41af613e7640AE20B` |
| StaticApySource | `0x02874283bd490350Ace341bc9Cdd4E7A686CB4E1` |
| CreLiquidationReceiver | `0x32866b81408d0260259BC0109b9F0a300Cdca132` |
| FeeFallbackSwapRouter | `0xEB66D88296C1694d79D578A700cb4EE0d6dC8baf` |
| PairVault USDC/WETH | `0xE47ABe4b88Fa2F47f4913710e8ecfBDE1205A5dc` |
| PairVault USDC/USDT | `0x9cf1CF796147DD6c4Ff2f57E91F67fe14397d8eF` |
| PairVault USDC/WBTC | `0xE374DEF41E1c63d54FFeB7B4a3fbA554574A4F84` |

## License

See repository license file if present; otherwise all rights reserved by the project owners unless otherwise stated.
