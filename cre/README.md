# LPFY - CRE Liquidation Keeper

Cron every 5 minutes → `CreLiquidationReceiver.needsUpkeep()` → if a loan is underwater,
`writeReport(loanId)` via KeystoneForwarder → `onReport` → `MarketLendingModule.liquidate`.

**Debt asset:** Circle Sepolia USDC. Liquidation swaps non-USDC LP legs via SwapRouter02 → USDC, then:

1. **Repays debt into the pair’s ERC-4626 `PairVault`** (`pushLiquidity`)
2. Takes **`liquidationFeeBps`** of remaining surplus → market **`feeTo`**
3. Sends leftover surplus to the **borrower**

CRE does not configure fees; it only calls liquidate. Fees are set on the market (`setLiquidationFeeBps` / `setFeeTo`).

**Latest Sepolia deploy** (see [Sepolia markets deployment](../smart-contracts/deployments/sepolia-markets.json)):

| Contract | Address |
|----------|---------|
| MarketLendingModule | `0x658A244Ad0c51F0C49d1fF79678bc642365b6E65` |
| CreLiquidationReceiver | `0xc9682A8649B7587e43a9cb85068d23081C5397F7` |
| Forwarder (Keystone) | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| V3Adapter | `0x8Aafb1e3941E9b5f6b947e6213ab6Bf397845768` |
| V4Adapter | `0x33234ac1508034A9494baa3d82D055a6b1ae92Bd` |
| PairVault USDC/WETH | `0x9478AD78af6C7758ADf8Aa78C2cc5ADEd5990843` |
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
