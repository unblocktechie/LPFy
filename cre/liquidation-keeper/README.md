# LPFY — CRE liquidation keeper

Automates liquidation for **Uniswap V3 / V4 LP NFT**–collateralized loans.

Cron → read `needsUpkeep()` → if liquidatable, `writeReport(loanId)` via KeystoneForwarder → `CreLiquidationReceiver.onReport` → `MarketLendingModule.liquidate` (authorized only).

**Debt asset:** Circle Sepolia USDC.

On liquidate: Uniswap adapter **unwind** → **SwapRouter02** → USDC → repay ERC-4626 PairVault (`pushLiquidity`) → `liquidationFeeBps` of surplus → `feeTo` → remainder → borrower.

CRE does not set fees; configure on the market (`setLiquidationFeeBps` / `setFeeTo`).

## Addresses (Sepolia)

Source: [Sepolia markets deployment](../../smart-contracts/deployments/sepolia-markets.json)

| Contract | Address |
| -------- | ------- |
| MarketLendingModule | `0x618a17C71b1D3922172E1b77D6e3D17704DE9f41` |
| CreLiquidationReceiver | `0x32866b81408d0260259BC0109b9F0a300Cdca132` |
| PairVault USDC/WETH | `0xE47ABe4b88Fa2F47f4913710e8ecfBDE1205A5dc` |
| Forwarder (Keystone) | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |

[Staging config](./config.staging.json) / [production config](./config.production.json) → `contractAddress` must match **CreLiquidationReceiver**.

Pattern: [keeper-bot TypeScript template](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/keeper-bot/keeper-bot-ts).

## Who can liquidate?

- Market owner (admin) via `liquidate(loanId)` or the web Liquidate page (admin-only)
- `CreLiquidationReceiver` (CRE only), authorized on the market
- Anyone else reverts with `NotLiquidationAuthority`

## Setup (Sepolia)

1. Redeploy markets if needed (from `smart-contracts/`):

   ```powershell
   npm run redeploy:sepolia
   ```

   This updates [staging config](./config.staging.json) / [production config](./config.production.json) in this folder.

2. Confirm [staging config](./config.staging.json) `contractAddress` is the CreLiquidationReceiver above.

3. Set [cre/.env](../.env.example) → `CRE_ETH_PRIVATE_KEY` (64 hex chars, **no** `0x`) for `--broadcast`.

4. Simulate (from `cre/`):

   ```powershell
   cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings
   cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings --broadcast
   ```

Full guide: [CRE README](../README.md) · Docs: [Chainlink & CRE](../../docs/Chainlink_CRE.pdf)
