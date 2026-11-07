# CRE Liquidation Keeper

Automates liquidation of loans backed by **Uniswap V3 / V4 LP NFT** collateral.

Cron every 5 minutes → `CreLiquidationReceiver.needsUpkeep()` → if a loan is underwater,
`writeReport(loanId)` via KeystoneForwarder → `onReport` → `MarketLendingModule.liquidate`.

On liquidate the market **unwinds the Uniswap LP** (V3 NPM or V4 PositionManager via adapters), then swaps non-USDC legs via **Uniswap SwapRouter02** → Circle USDC, then:

1. **Repays debt into the pair’s ERC-4626 `PairVault`** (`pushLiquidity`)
2. Takes **`liquidationFeeBps`** of remaining surplus → market **`feeTo`**
3. Sends leftover surplus to the **borrower**

CRE does not configure fees; it only calls liquidate. Fees are set on the market (`setLiquidationFeeBps` / `setFeeTo`).

**Latest Sepolia deploy** (see `smart-contracts/deployments/sepolia-markets.json`):

| Contract | Address |
|----------|---------|
| MarketLendingModule | `0x618a17C71b1D3922172E1b77D6e3D17704DE9f41` |
| CreLiquidationReceiver | `0x32866b81408d0260259BC0109b9F0a300Cdca132` |
| Forwarder (Keystone) | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| V3Adapter | `0x48ee590E073f5ae2FDFCEA465e6281115308dDc9` |
| V4Adapter | `0x646DB0572422424947262fC3Bda2940f51504759` |
| PairVault USDC/WETH | `0xE47ABe4b88Fa2F47f4913710e8ecfBDE1205A5dc` |
| SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |

[Staging config](liquidation-keeper/config.staging.json) / [production config](liquidation-keeper/config.production.json) → `contractAddress` must match **CreLiquidationReceiver** (redeploy script updates these automatically).

Based on the [keeper-bot TypeScript template](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/keeper-bot/keeper-bot-ts).

---

## 1. Install tools (Windows)

### CRE CLI

```powershell
irm https://app.chain.link/cre/install.ps1 | iex
```

```powershell
cre version
cre login
cre whoami
```

### Bun (≥ 1.2.21)

```powershell
irm bun.sh/install.ps1 | iex
```

---

## 2. Configure secrets

From `cre/`:

```powershell
copy .env.example .env
```

```
CRE_ETH_PRIVATE_KEY=your_private_key_here
SEPOLIA_RPC_URL=https://your-sepolia-rpc
```

(64 hex chars, **no** `0x`. Fund with Sepolia ETH for `--broadcast`.)

```powershell
node sync-rpc.js
```

---

## 3. Install workflow deps

```powershell
cd liquidation-keeper
bun install
cd ..
```

---

## 4. Simulate (dry run)

From `cre/`:

```powershell
cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings
```

---

## 5. Simulate with real liquidation tx

```powershell
cre workflow simulate liquidation-keeper --non-interactive --trigger-index 0 --target staging-settings --broadcast
```

On success, check transfers: USDC to **PairVault** (debt), to **`feeTo`** (fee), to **borrower** (surplus).

---

## Keeper loop (writes a log file)

From `cre/`. Repeats every 5 minutes and appends output to [log/logFile.txt](log/logFile.txt). Stop with `Ctrl+C`.

Dry run (no on-chain tx):

```powershell
powershell -ExecutionPolicy Bypass -File .\run-keeper-loop.ps1
```

Broadcast (real liquidation tx):

```powershell
powershell -ExecutionPolicy Bypass -File .\run-keeper-loop.ps1 -Broadcast
```

---

## 6. Deploy (after org access)

```powershell
cre account access
cre workflow deploy liquidation-keeper --target staging-settings
```

---

## Local fallback (no CRE key)

From `smart-contracts/`:

```powershell
npx hardhat run scripts/run-liquidation-keeper-local.js --network sepolia
```

Or web **Liquidate** (owner only).

---

## Who can liquidate

| Caller | Allowed? |
|--------|----------|
| Market owner | Yes |
| `CreLiquidationReceiver` (via Forwarder) | Yes |
| Anyone else | No (`NotLiquidationAuthority`) |

Related: [Chainlink & CRE](../docs/Chainlink_CRE.pdf), [Project Overview](../docs/Project_Overview.pdf), [Smart contracts README](../smart-contracts/README.md).
