# LPFY Docs — Uniswap LP NFT lending

Architecture and operator guides for **LPFY**: borrow Circle USDC against **Uniswap V3 / V4 LP NFTs**, with isolated ERC-4626 pair vaults and optional Chainlink CRE liquidation.

## Start here

| Doc | Topic |
| --- | ----- |
| **[Project Overview](./Project_Overview.pdf)** | Uniswap collateral, PairVaults, fees, flows |
| **[Contract Architecture](./Smart_Contract_Architecture.pdf)** | Adapters, SwapRouter02, custody, function surfaces |
| **[Chainlink & CRE](./Chainlink_CRE.pdf)** | Chainlink Data Feeds + CRE keeper |
| **[Setup & Deploy guide](./SETUP_AND_DEPLOY.md)** | Env, Uniswap Sepolia addresses, deploy, web, CRE |
| **[Demo video script](./DEMO_VIDEO_SCRIPT.md)** | Reusable VO ([plain `.txt`](./DEMO_VIDEO_SCRIPT.txt)) |

## What we use from Uniswap

LPFY integrates the **on-chain Uniswap AMM (v3 + v4)** — not the SDK, Trading API, CCA, or custom hooks.

| Uniswap surface | Role in LPFY |
| --------------- | ------------ |
| **V3 NonfungiblePositionManager** | LP NFT custody / unwind (`V3Adapter`) |
| **V3 Factory + Pool `slot0`** | Pool lookup + LP amount valuation |
| **V4 PositionManager** | LP NFT custody / unwind (`V4Adapter`) |
| **V4 StateView** | Tick / liquidity reads for valuation |
| **SwapRouter02** | Liquidation: non-USDC → Circle USDC (`exactInputSingle`, fee-tier fallback) |

Hackathon feedback: [`../FEEDBACK.md`](../FEEDBACK.md). Root reviewer map: [`../README.md`](../README.md#uniswap-integration-reviewer-map).

### ERC-4626 (summary)

- One **`PairVault`** per market pair (USDC/WETH, USDC/USDT, USDC/WBTC)
- Lenders use standard ERC-4626 `deposit` / `redeem`
- Market pulls liquidity on borrow and pushes on repay / liquidation recovery
- `totalAssets = idle vault USDC + principal + accrued interest`

### Liquidation fee structure

- `liquidationFeeBps` — cut of **surplus** after vault is repaid (e.g. `1000` = 10%)
- `feeTo` — fee recipient wallet (separate from contract `owner`)
- Remainder of surplus → borrower; shortfall → no fee paid

Related packages: [Smart contracts](../smart-contracts/), [Web](../web/), [CRE](../cre/).

## Deployed contracts (Sepolia)

Canonical file: [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json). Full table: [Setup & Deploy — section 12](./SETUP_AND_DEPLOY.md#12-deployed-contracts-sepolia).

| Contract | Address |
| -------- | ------- |
| MarketLendingModule | `0x618a17C71b1D3922172E1b77D6e3D17704DE9f41` |
| ValuationOracle | `0x16E03515cf524B5D0D0db6E44F342ef0af7301e3` |
| CreLiquidationReceiver | `0x32866b81408d0260259BC0109b9F0a300Cdca132` |
| FeeFallbackSwapRouter | `0xEB66D88296C1694d79D578A700cb4EE0d6dC8baf` |
| PairVault USDC/WETH | `0xE47ABe4b88Fa2F47f4913710e8ecfBDE1205A5dc` |
| PairVault USDC/USDT | `0x9cf1CF796147DD6c4Ff2f57E91F67fe14397d8eF` |
| PairVault USDC/WBTC | `0xE374DEF41E1c63d54FFeB7B4a3fbA554574A4F84` |
