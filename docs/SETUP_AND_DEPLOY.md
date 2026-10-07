# Setup & Deploy Guide (Sepolia → Web → CRE)

**Repository:** [github.com/unblocktechie/LPFy](https://github.com/unblocktechie/LPFy)

End-to-end guide: configure RPCs and external addresses, deploy the markets stack, wire the web app, then run the Chainlink CRE liquidation keeper.

**Current product path:** `MarketLendingModule` + Circle Sepolia **USDC** debt + V3/V4 LP collateral + CRE `CreLiquidationReceiver`.

Run Hardhat commands from [`smart-contracts/`](../smart-contracts/) (`cd smart-contracts`). Live addresses: [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json).

---

## 1. What you will set up

| Layer                         | What                                                               | Where configured                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External (already on Sepolia) | Uniswap, Chainlink feeds, Circle USDC, SwapRouter02, CRE Forwarder | Fixed addresses (section 4)                                                                                                                                                              |
| Your contracts                | Oracle, rates, APY, market, adapters, CRE receiver                 | Hardhat scripts → [`Sepolia markets deployment`](../smart-contracts/deployments/sepolia-markets.json)                                                                                    |
| Web                           | RPCs + `VITE_*` contract addresses                                 | [`web/.env`](../web/.env.example) — see [`Web README`](../web/README.md)                                                                                                                 |
| CRE                           | RPC + private key + receiver address                               | [`cre/.env`](../cre/.env.example) + [`cre/project.yaml`](../cre/project.yaml) + [`staging config`](../cre/liquidation-keeper/config.staging.json) — see [`CRE README`](../cre/README.md) |

Each app has its **own** env (they are not shared):

| App                 | File                                                        |
| ------------------- | ----------------------------------------------------------- |
| Hardhat / contracts | [`smart-contracts/.env`](../smart-contracts/.env.example)   |
| Web                 | [`web/.env`](../web/.env.example)                           |
| CRE                 | [`cre/.env`](../cre/.env.example) (then `node sync-rpc.js`) |

---

## 2. Prerequisites

- Node.js 18+ (20+ recommended)
- npm
- A wallet with **Sepolia ETH** (deploy + txs)
- Circle Sepolia **USDC** if you will seed lender pools (`FUND_PER_PAIR`)
- Optional CRE: [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation), [Bun](https://bun.sh) ≥ 1.2.21, `cre login`

```bash
cd smart-contracts
npm install
npx hardhat compile
```

Web and CRE installs are covered in [section 6 (Web setup)](#6-web-setup) and [section 7 (CRE)](#7-cre-setup-and-run).

---

## 3. Environment files

### 3.1 Hardhat — [`smart-contracts/.env`](../smart-contracts/.env.example)

```bash
cd smart-contracts
cp .env.example .env
```

```env
PRIVATE_KEY=0xYOUR_DEPLOYER_KEY
SEPOLIA_RPC_URL=https://YOUR_SEPOLIA_RPC
MAINNET_RPC_URL=https://YOUR_MAINNET_RPC
LOCALHOST_RPC_URL=http://127.0.0.1:8545
ETHERSCAN_API_KEY=
```

Never commit `.env`. Details: [Smart contracts README](../smart-contracts/README.md).

### 3.2 Web — [`web/.env`](../web/.env.example)

```bash
cd web
cp .env.example .env
```

Set RPCs, then paste addresses from the [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json) `webEnv` block (see [section 6](#6-web-setup)), or run `npm run sync:addresses` from `smart-contracts/`.

Full UI guide: [Web README](../web/README.md).

### 3.3 CRE — [`cre/.env`](../cre/.env.example)

```bash
cd cre
cp .env.example .env
```

```env
CRE_ETH_PRIVATE_KEY=YOUR_64_HEX_CHARS_NO_0x
SEPOLIA_RPC_URL=https://YOUR_SEPOLIA_RPC
```

```bash
node sync-rpc.js
```

Re-run `sync-rpc.js` whenever you change `SEPOLIA_RPC_URL`. Details: [CRE README](../cre/README.md).

---

## 4. Fixed Sepolia addresses (do not deploy)

Wire these into the oracle / market / CRE config. They already exist on Sepolia.

### Tokens

| Asset                       | Address                                      | Decimals |
| --------------------------- | -------------------------------------------- | -------- |
| Circle USDC (debt + LP leg) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6        |
| WETH                        | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | 18       |
| USDT                        | `0xE699A7254f05f93a539120BA640bf2D1C87b48f1` | 6        |
| WBTC                        | `0x65bBDdD937C4CE8aCf308c0787b857664616BC2c` | 8        |

### Uniswap

| Contract                                     | Address                                      |
| -------------------------------------------- | -------------------------------------------- |
| V3 NonfungiblePositionManager                | `0x1238536071E1c677A632429e3655c799b22cDA52` |
| V3 Factory                                   | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| V3 SwapRouter02 (**use this exact address**) | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| V4 PositionManager                           | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` |
| V4 StateView                                 | `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C` |

### Chainlink USD feeds (AggregatorV3)

| Feed       | Address                                      |
| ---------- | -------------------------------------------- |
| ETH / USD  | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| USDC / USD | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` |
| BTC / USD  | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |

### Chainlink CRE

| Contract          | Address                                      |
| ----------------- | -------------------------------------------- |
| KeystoneForwarder | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |

---

## 5. Contracts: choose a path

Commands below run from [`smart-contracts/`](../smart-contracts/). See [Smart contracts README](../smart-contracts/README.md).

### Path A — Use the current Sepolia deploy

If the [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json) already matches the on-chain stack you want:

1. Skip redeploy.
2. Continue with [Web setup](#6-web-setup) and [CRE setup](#7-cre-setup-and-run).

### Path B — Redeploy market stack

Redeploys the market, adapters, vaults, and CRE receiver (keeps oracle / rates / APY):

```bash
$env:FUND_PER_PAIR="0"
npm run redeploy:sepolia
```

### Path C — Full deploy of all LPFY contracts

```bash
$env:FUND_PER_PAIR="0"
$env:LIQUIDATION_FEE_BPS="1000"
$env:FEE_TO="0xYourFeeWallet"
npm run deploy:sepolia
npm run verify:sepolia
```

Then sync addresses into the web app ([section 6](#6-web-setup)), or run `npm run sync:addresses`.

### What each of your contracts does

| Contract                  | Role                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ValuationOracle`         | Uniswap LP amounts × Chainlink USD; feeds must be set for WETH, USDC, USDT, WBTC (and native ETH `address(0)` if using V4 ETH pairs) |
| `BorrowRateConfig`        | Per-pair borrow APR + which pairs are enabled                                                                                        |
| `StaticApySource`         | Lender **display** APY only (UI); real yield = borrower interest                                                                     |
| `V3Adapter` / `V4Adapter` | Custody of LP NFTs                                                                                                                   |
| `MarketLendingModule`     | Lend / borrow / repay / liquidate entrypoint                                                                                         |
| `CreLiquidationReceiver`  | CRE `onReport` → `liquidate`; must be authorized on the market                                                                       |

### Oracle feed checklist (before borrowing works)

On `ValuationOracle` (owner):

| Token                                  | Feed                                        |
| -------------------------------------- | ------------------------------------------- |
| WETH                                   | ETH/USD                                     |
| `address(0)` (optional, V4 native ETH) | ETH/USD                                     |
| Circle USDC                            | USDC/USD                                    |
| USDT                                   | USDC/USD (or dedicated feed if you add one) |
| WBTC                                   | BTC/USD                                     |

Also set a sensible `maxPriceAge` (e.g. 24h on testnet).

### Pair checklist

On `BorrowRateConfig`, enable pairs used by the UI, e.g.:

- USDC ↔ WETH
- USDC ↔ USDT
- USDC ↔ WBTC

Lender pools are **isolated per `pairId`**. Seed Circle USDC with `FUND_PER_PAIR` or supply from the UI.

---

## 6. Web setup

Full package guide: [Web README](../web/README.md). Architecture: [Project Overview](./Project_Overview.pdf).

### 6.1 Install

```bash
cd web
npm install
```

### 6.2 Configure env

```bash
cp .env.example .env
```

**Option A — sync from deployment (recommended)**

From [`smart-contracts/`](../smart-contracts/):

```bash
npm run sync:addresses
```

This refreshes contract lines in `web/.env` from the [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json) `webEnv` block and keeps your RPC URLs.

**Option B — paste manually**

Copy the `webEnv` object from the [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json) into `web/.env`, and set RPCs:

```env
VITE_SEPOLIA_RPC_URL=https://...
VITE_MAINNET_RPC_URL=https://...
VITE_LOCALHOST_RPC_URL=http://127.0.0.1:8545
VITE_NETWORK=sepolia
VITE_SEPOLIA_MARKET_MODULE=0x658A244Ad0c51F0C49d1fF79678bc642365b6E65
VITE_SEPOLIA_ORACLE=0xA659A2C34c5E9026f7777AF654d0F742f8444f7F
VITE_SEPOLIA_V3_ADAPTER=0x8Aafb1e3941E9b5f6b947e6213ab6Bf397845768
VITE_SEPOLIA_V4_ADAPTER=0x33234ac1508034A9494baa3d82D055a6b1ae92Bd
VITE_SEPOLIA_USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
VITE_SEPOLIA_BORROW_RATES=0xb2e0c7b38b7DECE87A4E3D41A465F0175Ff65d25
VITE_SEPOLIA_APY_SOURCE=0x2b0B69EB316BCBaCc7167Dc1764637a7eBD296C2
VITE_SEPOLIA_USDT=0xE699A7254f05f93a539120BA640bf2D1C87b48f1
VITE_SEPOLIA_WBTC=0x65bBDdD937C4CE8aCf308c0787b857664616BC2c
VITE_SEPOLIA_CRE_RECEIVER=0xc9682A8649B7587e43a9cb85068d23081C5397F7
VITE_SEPOLIA_VAULT_USDC_WETH=0x9478AD78af6C7758ADf8Aa78C2cc5ADEd5990843
VITE_SEPOLIA_VAULT_USDC_USDT=0xCE934C71ed024Da403fB68EC4C9e26C996d7E7ca
VITE_SEPOLIA_VAULT_USDC_WBTC=0xab30B8fEBEAdf0B2094Db087Df3CA4E632e27Ca0
```

Example env template: [`web/.env.example`](../web/.env.example).

### 6.3 Run the app

```bash
cd web
npm run dev
```

Open http://localhost:5173 and connect a wallet on **Sepolia**.

| What you can do                | How                              |
| ------------------------------ | -------------------------------- |
| Browse markets                 | `/` or `/markets`                |
| Supply USDC / borrow vs LP NFT | Markets → pair → Supply / Borrow |
| View your supplies and loans   | `/assets`                        |

---

## 7. CRE setup and run

Detailed CRE notes: [CRE README](../cre/README.md) · Showcase: [Chainlink & CRE](./Chainlink_CRE.pdf).

### 7.1 Point the workflow at your receiver

Edit [staging config](../cre/liquidation-keeper/config.staging.json) (and [production config](../cre/liquidation-keeper/config.production.json) if used):

```json
{
	"schedule": "0 */5 * * * *",
	"evms": [
		{
			"chainSelectorName": "ethereum-testnet-sepolia",
			"contractAddress": "0xYOUR_CreLiquidationReceiver"
		}
	]
}
```

`contractAddress` must equal `contracts.creLiquidationReceiver` in the [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json).

### 7.2 Install workflow deps

```bash
cd cre/liquidation-keeper
bun install
cd ..
```

### 7.3 Sync RPC → `project.yaml`

```bash
cd cre
node sync-rpc.js
```

### 7.4 Simulate (dry run — no chain write)

```bash
cre workflow simulate liquidation-keeper --target staging-settings
```

Non-interactive (cron trigger index 0):

```bash
cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings
```

Healthy result when nothing is liquidatable:

```
needsUpkeep=false ...
Skipped — no upkeep needed
```

### 7.5 Broadcast a real liquidation

When a loan is underwater and you have Sepolia ETH on the CRE key:

```bash
cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings --broadcast
```

Check KeystoneForwarder logs: `ReportProcessed(result=true)` means `liquidate` succeeded.

### 7.6 Always-on CRE deploy (optional)

Requires CRE org access:

```bash
cre account access
cre workflow deploy liquidation-keeper --target staging-settings
```

### 7.7 Local keeper fallback (no CRE)

Market owner via Hardhat (from [`smart-contracts/`](../smart-contracts/)):

```bash
npm run keeper:local
```

---

## 8. Recommended order (checklist)

Use this when bringing up a machine or a new Sepolia stack.

- [ ] [`smart-contracts/.env`](../smart-contracts/.env.example) with `PRIVATE_KEY` + `SEPOLIA_RPC_URL`
- [ ] `cd smart-contracts` → `npm install` + `npx hardhat compile`
- [ ] Confirm external addresses ([`section 4`](#4-fixed-sepolia-addresses-do-not-deploy)) — especially SwapRouter02 `…Ae48E`
- [ ] Path A (existing deployment JSON) **or** Path B/C deploy → refresh [`Sepolia markets deployment`](../smart-contracts/deployments/sepolia-markets.json)
- [ ] Oracle feeds set for all LP legs + debt USDC
- [ ] Pairs enabled on `BorrowRateConfig`; pools seeded if needed
- [ ] Web: `cd web` → `npm install` → configure `web/.env` ([`section 6`](#6-web-setup)) → `npm run dev`
- [ ] Smoke: connect wallet → Markets → supply USDC → list LP → borrow
- [ ] CRE: [`cre/.env`](../cre/.env.example) + `node sync-rpc.js`
- [ ] [`Staging config`](../cre/liquidation-keeper/config.staging.json) → `CreLiquidationReceiver`
- [ ] `cre workflow simulate …` (dry run)
- [ ] Optional: underwater loan → simulate `--broadcast`

---

## 9. Smoke tests

| Step         | Expect                                                              |
| ------------ | ------------------------------------------------------------------- |
| Open Markets | Pairs load (USDC/WETH, …)                                           |
| Supply USDC  | Balance / shares update on Assets                                   |
| Borrow scan  | Non-zero LP NFTs for the pair appear; $0 liquidity positions hidden |
| Borrow       | Debt appears; NFT held by adapter                                   |
| CRE simulate | `needsUpkeep=false` if healthy; `true` + report if liquidatable     |

---

## 10. Troubleshooting

| Symptom                                   | Fix                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardhat “missing RPC” / empty network URL | Set `SEPOLIA_RPC_URL` in [`smart-contracts/.env`](../smart-contracts/.env.example)                                                           |
| Web blank / RPC errors                    | Set `VITE_*_RPC_URL` in [`web/.env`](../web/.env.example), restart Vite — see [`Web README`](../web/README.md)                               |
| Wrong contracts in UI                     | Re-run `npm run sync:addresses` or re-copy `webEnv` from [`Sepolia markets deployment`](../smart-contracts/deployments/sepolia-markets.json) |
| Borrow / valuation fails                  | Oracle feeds + `maxPriceAge`; pair enabled in `BorrowRateConfig`                                                                             |
| Liquidation swap fails                    | Confirm SwapRouter02 is `0x3bFA…Ae48E` (not the empty typo address)                                                                          |
| CRE `ReportProcessed(false)`              | Tx mined but `liquidate` reverted (router / liquidity / authority)                                                                           |
| CRE broadcast fails                       | `CRE_ETH_PRIVATE_KEY` in [`cre/.env`](../cre/.env.example) (no `0x`), funded with Sepolia ETH                                                |
| CRE still on old RPC                      | Change [`cre/.env`](../cre/.env.example) → `node sync-rpc.js`                                                                                |
| Not authorized to liquidate               | Only market owner or `CreLiquidationReceiver`                                                                                                |

---

## 11. Related docs

| Doc                                                                               | Purpose                       |
| --------------------------------------------------------------------------------- | ----------------------------- |
| [Project README](../README.md)                                                    | Project overview              |
| [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json) | Live Sepolia addresses        |
| [Smart contracts README](../smart-contracts/README.md)                            | Deploy, verify, ops scripts   |
| [Web README](../web/README.md)                                                    | UI install, env, routes       |
| [CRE README](../cre/README.md)                                                    | CRE simulate / deploy details |
| [Markets contracts notes](../smart-contracts/contracts/markets/README.md)         | Markets package notes         |
| [Project Overview](./Project_Overview.pdf)                                        | Vaults, fees, flows           |
| [Contract Architecture](./Smart_Contract_Architecture.pdf)                        | Interactive architecture      |
| [Chainlink & CRE](./Chainlink_CRE.pdf)                                            | CRE showcase                  |
| [Chainlink CRE docs](https://docs.chain.link/cre)                                 | Official CRE                  |

---

## 12. Deployed contracts (Sepolia)

Live stack from `npm run deploy:sepolia` (2026-10-06). Source: [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json).

| Contract               | Address                                      |
| ---------------------- | -------------------------------------------- |
| MarketLendingModule    | `0x658A244Ad0c51F0C49d1fF79678bc642365b6E65` |
| ValuationOracle        | `0xA659A2C34c5E9026f7777AF654d0F742f8444f7F` |
| V3Adapter              | `0x8Aafb1e3941E9b5f6b947e6213ab6Bf397845768` |
| V4Adapter              | `0x33234ac1508034A9494baa3d82D055a6b1ae92Bd` |
| BorrowRateConfig       | `0xb2e0c7b38b7DECE87A4E3D41A465F0175Ff65d25` |
| StaticApySource        | `0x2b0B69EB316BCBaCc7167Dc1764637a7eBD296C2` |
| CreLiquidationReceiver | `0xc9682A8649B7587e43a9cb85068d23081C5397F7` |
| PairVault USDC/WETH    | `0x9478AD78af6C7758ADf8Aa78C2cc5ADEd5990843` |
| PairVault USDC/USDT    | `0xCE934C71ed024Da403fB68EC4C9e26C996d7E7ca` |
| PairVault USDC/WBTC    | `0xab30B8fEBEAdf0B2094Db087Df3CA4E632e27Ca0` |

Debt asset: Circle USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. Risk defaults in JSON: LTV 50%, LT 65%, liquidation fee 10%.
