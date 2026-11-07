# LPFY Markets — Web

React + Vite UI for **Uniswap V3 / V4 LP NFT** lending on **Ethereum Sepolia**.

Borrowers post Uniswap LP NFTs as collateral; lenders supply Circle USDC into isolated pair vaults. Markets are listed as separate **V3** and **V4** rows per pair.

**Debt asset:** Circle Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, 6 decimals).

**Market:** `MarketLendingModule` · **Supply:** per-pair **ERC-4626 `PairVault`** (not `lendUsdc`) · **Collateral:** Uniswap NPM / PositionManager NFTs via `V3Adapter` / `V4Adapter`.

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
2. Set `VITE_WALLETCONNECT_ID` from [WalletConnect Cloud](https://cloud.walletconnect.com) (needed for WalletConnect / mobile wallets; browser extensions like MetaMask still work without it).
3. Load contract addresses — either paste the `webEnv` block from [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json), or from `smart-contracts/` run:

   ```bash
   npm run sync:addresses
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

Open http://localhost:5173 and connect via **RainbowKit** (MetaMask, WalletConnect, Coinbase Wallet, and other installed wallets) on **Sepolia**.

Full end-to-end setup: [Setup & Deploy guide](../docs/SETUP_AND_DEPLOY.md).

## Routes

| Route             | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `/` or `/markets` | Browse Uniswap V3/V4 pair markets, vault supply, borrow vs LP NFT |
| `/assets`         | Your vault supplies + Uniswap-backed loans |

## Env ([web/.env](.env.example))

```env
VITE_NETWORK=sepolia
VITE_SEPOLIA_MARKET_MODULE=0x618a17C71b1D3922172E1b77D6e3D17704DE9f41
VITE_SEPOLIA_ORACLE=0x16E03515cf524B5D0D0db6E44F342ef0af7301e3
VITE_SEPOLIA_V3_ADAPTER=0x48ee590E073f5ae2FDFCEA465e6281115308dDc9
VITE_SEPOLIA_V4_ADAPTER=0x646DB0572422424947262fC3Bda2940f51504759
VITE_SEPOLIA_USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
VITE_SEPOLIA_BORROW_RATES=0x96ff2ce7B8AEfEadCAF460f41af613e7640AE20B
VITE_SEPOLIA_APY_SOURCE=0x02874283bd490350Ace341bc9Cdd4E7A686CB4E1
VITE_SEPOLIA_USDT=0xE699A7254f05f93a539120BA640bf2D1C87b48f1
VITE_SEPOLIA_WBTC=0x65bBDdD937C4CE8aCf308c0787b857664616BC2c
VITE_SEPOLIA_CRE_RECEIVER=0x32866b81408d0260259BC0109b9F0a300Cdca132
VITE_SEPOLIA_VAULT_USDC_WETH=0xE47ABe4b88Fa2F47f4913710e8ecfBDE1205A5dc
VITE_SEPOLIA_VAULT_USDC_USDT=0x9cf1CF796147DD6c4Ff2f57E91F67fe14397d8eF
VITE_SEPOLIA_VAULT_USDC_WBTC=0xE374DEF41E1c63d54FFeB7B4a3fbA554574A4F84
```

Prefer live `vaultOf(pairId)` on-chain; env vaults are fallbacks. Restart Vite after changes.

## Pairs (Uniswap collateral)

Isolated vaults for **USDC/WETH**, **USDC/USDT**, **USDC/WBTC** — each shown for **Uniswap V3** and **Uniswap V4** where positions exist. V4 native ETH pools map to the WETH vault via the adapter.

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
