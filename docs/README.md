# LPFY - Docs

Architecture and operator guides. Open the PDFs below.

## Start here

| Doc                                                            | Topic                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| **[Project Overview](./Project_Overview.pdf)**                 | PairVaults, fees, flows, ops                          |
| **[Contract Architecture](./Smart_Contract_Architecture.pdf)** | Smart contract map, custody, flows, function surfaces |
| **[Chainlink & CRE](./Chainlink_CRE.pdf)**                     | Chainlink Data Feeds + CRE keeper                     |
| **[Setup & Deploy guide](./SETUP_AND_DEPLOY.md)**              | Env, deploy, web, CRE setup                           |

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

| Contract               | Address                                      |
| ---------------------- | -------------------------------------------- |
| MarketLendingModule    | `0x658A244Ad0c51F0C49d1fF79678bc642365b6E65` |
| ValuationOracle        | `0xA659A2C34c5E9026f7777AF654d0F742f8444f7F` |
| CreLiquidationReceiver | `0xc9682A8649B7587e43a9cb85068d23081C5397F7` |
| PairVault USDC/WETH    | `0x9478AD78af6C7758ADf8Aa78C2cc5ADEd5990843` |
| PairVault USDC/USDT    | `0xCE934C71ed024Da403fB68EC4C9e26C996d7E7ca` |
| PairVault USDC/WBTC    | `0xab30B8fEBEAdf0B2094Db087Df3CA4E632e27Ca0` |
