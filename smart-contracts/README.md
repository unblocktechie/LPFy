# LPFY — Smart contracts (Hardhat)

Uniswap-centric markets stack on Sepolia: lend Circle USDC against **Uniswap V3 / V4 LP NFTs**.

**Uniswap surfaces used:** V3 NonfungiblePositionManager + Factory/Pool · V4 PositionManager + StateView · SwapRouter02 (liquidation swaps). No Uniswap SDK / API / hooks.

- **`V3Adapter` / `V4Adapter`** — custody, value, and unwind Uniswap LP NFTs
- **`MarketLendingModule`** — borrow / repay / liquidate; `_swapToUsdc` via SwapRouter02
- **`FeeFallbackSwapRouter`** — optional fee-tier retries when V4 LP fees ≠ V3 pools
- **`PairVault` (ERC-4626)** — one vault per pair; holds **idle USDC**; lenders deposit/redeem here
- `ValuationOracle`, `BorrowRateConfig`, `StaticApySource`
- **`CreLiquidationReceiver`** — CRE `onReport` → `liquidate`

Reviewer map: [root README — Uniswap integration](../README.md#uniswap-integration-reviewer-map) · [FEEDBACK.md](../FEEDBACK.md)

## Setup

```bash
cd smart-contracts
cp .env.example .env   # PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY
npm install
npx hardhat compile
npx hardhat test
```

## Deploy

One command deploys every LPFY contract, wires them, sets feeds / pairs / APY / risk, and writes [Sepolia markets deployment](./deployments/sepolia-markets.json) plus CRE keeper configs:

```bash
cd smart-contracts
npm run deploy:sepolia
```

Optional env (PowerShell):

```powershell
$env:FUND_PER_PAIR="0"
$env:LIQUIDATION_FEE_BPS="1000"
$env:FEE_TO="0xYourFeeWallet"
$env:DEFAULT_LTV_BPS="5000"
$env:DEFAULT_LT_BPS="6500"
npm run deploy:sepolia
```

Deploys: `BorrowRateConfig`, `ValuationOracle`, `StaticApySource`, adapters, `MarketLendingModule`, 3× `PairVault`, `CreLiquidationReceiver`.

Does **not** deploy externals (Circle USDC, Uniswap V3/V4 periphery, SwapRouter02, Chainlink feeds, CRE Forwarder) — those are fixed Sepolia addresses.

### Verify on Etherscan

```bash
npm run verify:sepolia
```

### Sync addresses to the web app and docs

```bash
npm run sync:addresses
```

Updates [web/.env](../web/.env.example), README examples, and [CRE README](../cre/README.md). Restart Vite after syncing.

### Redeploy market stack

Redeploys the market, adapters, vaults, and CRE receiver while keeping the existing oracle, rate config, and APY source:

```bash
npm run redeploy:sepolia
```

## Ops scripts

| Command | Purpose |
|---------|---------|
| `LTV_BPS=5000 LT_BPS=6500 npm run set:risk` | Change live LTV + liquidation threshold |
| `FEE_TO=0x... npm run set:fee-to` | Set fee recipient |
| `LIQUIDATION_FEE_BPS=1000 npm run set:liquidation-fee` | Set surplus fee bps |
| `npm run keeper:local` | Owner poll + liquidate (no CRE) |
| `LOAN_ID=1 npm run diagnose:liquidation` | Debug a loan |

## ERC-4626 PairVaults

| Flow | What happens |
|------|----------------|
| **Supply** | Approve USDC → `PairVault.deposit` / `mint` |
| **Borrow** | Market `pullLiquidity` from that pair’s vault → borrower |
| **Repay / liquidate recovery** | Market `pushLiquidity` back into the vault |
| **Withdraw** | `withdraw` / `redeem` — **idle cash only** |

Deep dive: [Project Overview](../docs/Project_Overview.pdf).

## Scripts

| Script | Role |
|--------|------|
| [deploy-all-sepolia.js](./scripts/deploy-all-sepolia.js) | Full Sepolia deploy |
| [redeploy-market-per-pair-sepolia.js](./scripts/redeploy-market-per-pair-sepolia.js) | Redeploy market stack |
| [verify-sepolia-markets.js](./scripts/verify-sepolia-markets.js) | Etherscan verify |
| [set-risk-params.js](./scripts/set-risk-params.js) | LTV / LT |
| [set-fee-to.js](./scripts/set-fee-to.js) / [set-liquidation-fee.js](./scripts/set-liquidation-fee.js) | Fee admin |
| [run-liquidation-keeper-local.js](./scripts/run-liquidation-keeper-local.js) | Local keeper |
| [diagnose-liquidation.js](./scripts/diagnose-liquidation.js) | Debug |
| [sync-addresses.js](./scripts/sync-addresses.js) | Push `webEnv` → web env + README tables |
| [sepolia-addresses.js](./scripts/sepolia-addresses.js) | Shared Sepolia constants |

## Deployed contracts (Sepolia)

Source: [Sepolia markets deployment](./deployments/sepolia-markets.json).

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
