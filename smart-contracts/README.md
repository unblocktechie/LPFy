# LPFY — Smart contracts (Hardhat)

Solidity markets stack for LP-collateralized lending on Sepolia:

- **`MarketLendingModule`** — borrow / repay / liquidate, pair books, LTV
- **`PairVault` (ERC-4626)** — one vault per pair; holds **idle USDC**; lenders deposit/redeem here
- Adapters (V3/V4), `ValuationOracle`, `BorrowRateConfig`, `StaticApySource`
- **`CreLiquidationReceiver`** — CRE `onReport` → `liquidate`

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

Does **not** deploy externals (Circle USDC, Uniswap, Chainlink feeds, CRE Forwarder).

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
| MarketLendingModule | `0x658A244Ad0c51F0C49d1fF79678bc642365b6E65` |
| ValuationOracle | `0xA659A2C34c5E9026f7777AF654d0F742f8444f7F` |
| V3Adapter | `0x8Aafb1e3941E9b5f6b947e6213ab6Bf397845768` |
| V4Adapter | `0x33234ac1508034A9494baa3d82D055a6b1ae92Bd` |
| BorrowRateConfig | `0xb2e0c7b38b7DECE87A4E3D41A465F0175Ff65d25` |
| StaticApySource | `0x2b0B69EB316BCBaCc7167Dc1764637a7eBD296C2` |
| CreLiquidationReceiver | `0xc9682A8649B7587e43a9cb85068d23081C5397F7` |
| PairVault USDC/WETH | `0x9478AD78af6C7758ADf8Aa78C2cc5ADEd5990843` |
| PairVault USDC/USDT | `0xCE934C71ed024Da403fB68EC4C9e26C996d7E7ca` |
| PairVault USDC/WBTC | `0xab30B8fEBEAdf0B2094Db087Df3CA4E632e27Ca0` |
