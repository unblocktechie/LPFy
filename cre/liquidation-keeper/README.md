# LPFY — CRE liquidation keeper

Cron → read `needsUpkeep()` → if liquidatable, `writeReport(loanId)` via KeystoneForwarder → `CreLiquidationReceiver.onReport` → `MarketLendingModule.liquidate` (authorized only).

**Debt asset:** Circle Sepolia USDC.

On liquidate: unwind LP → USDC → repay ERC-4626 PairVault (`pushLiquidity`) → `liquidationFeeBps` of surplus → `feeTo` → remainder → borrower.

CRE does not set fees; configure on the market (`setLiquidationFeeBps` / `setFeeTo`).

## Addresses (Sepolia)

Source: [`smart-contracts/deployments/sepolia-markets.json`](../../smart-contracts/deployments/sepolia-markets.json)

| Contract | Address |
| -------- | ------- |
| MarketLendingModule | `0x658A244Ad0c51F0C49d1fF79678bc642365b6E65` |
| CreLiquidationReceiver | `0xc9682A8649B7587e43a9cb85068d23081C5397F7` |
| PairVault USDC/WETH | `0x9478AD78af6C7758ADf8Aa78C2cc5ADEd5990843` |
| Forwarder (Keystone) | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |

`config.staging.json` / `config.production.json` → `contractAddress` must match **CreLiquidationReceiver**.

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

   This updates `config.staging.json` / `config.production.json` in this folder.

2. Confirm `config.staging.json` `contractAddress` is the CreLiquidationReceiver above.

3. Set `cre/.env` → `CRE_ETH_PRIVATE_KEY` (64 hex chars, **no** `0x`) for `--broadcast`.

4. Simulate (from `cre/`):

   ```powershell
   cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings
   cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings --broadcast
   ```
