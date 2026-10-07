# LPFY - Web

React + Vite UI for DEX LP NFT lending on **Ethereum Sepolia**.

**Debt asset:** Circle Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, 6 decimals).

**Market:** `MarketLendingModule` · **Supply:** per-pair **ERC-4626 `PairVault`** (not `lendUsdc`).

## ERC-4626 supply path

| Action    | UI / contract                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------- |
| Supply    | Approve USDC → `vault.deposit(assets, user)`                                                   |
| Withdraw  | `vault.withdraw` / `redeem` (idle cash only)                                                   |
| Balances  | `balanceOf` + `convertToAssets`; vault from `market.vaultOf(pairId)` or `VITE_SEPOLIA_VAULT_*` |
| Pool cash | Vault idle / market views that read vault                                                      |

Code: [SupplyPanel](src/features/supply/SupplyPanel.tsx), ABI in [abi.ts](src/abi.ts) (`pairVaultAbi`).

More detail: [Project Overview](../docs/Project_Overview.pdf).

## Installation

```bash
cd web
cp .env.example .env
npm install
```

1. Set `VITE_SEPOLIA_RPC_URL` (and other RPCs) in [web/.env](.env.example).
2. Load contract addresses — either paste the `webEnv` block from [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json), or from `smart-contracts/` run:

   ```bash
   npm run sync:addresses
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

Open http://localhost:5173 and connect on **Sepolia**.

Full end-to-end setup: [Setup & Deploy guide](../docs/SETUP_AND_DEPLOY.md).

## Routes

| Route             | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `/` or `/markets` | Browse pairs, vault supply, borrow vs LP NFT |
| `/assets`         | Your vault supplies + loans                  |

## Env ([web/.env](.env.example))

```env
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

Prefer live `vaultOf(pairId)` on-chain; env vaults are fallbacks. Restart Vite after changes.

## Pairs

Isolated pools + vaults: **USDC/WETH**, **USDC/USDT**, **USDC/WBTC**.

## Source layout

```text
src/
  App.tsx                 # providers only
  layout/AppShell.tsx
  features/supply|borrow|markets|loans|pool|positions/
  hooks/tx.tsx
```

## Related

- [Project README](../README.md)
- [Project Overview](../docs/Project_Overview.pdf)
- [Contract Architecture](../docs/Smart_Contract_Architecture.pdf)
- [Smart contracts README](../smart-contracts/README.md)
- [CRE README](../cre/README.md)
