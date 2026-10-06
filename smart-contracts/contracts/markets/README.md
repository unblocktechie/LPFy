# Markets — per-pair two-sided LPFY

## Roles

| Role         | Who                  | What they do                                       | Main functions                                                               |
| ------------ | -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Lender**   | Supplies Circle USDC | Earns from borrower interest via vault share price | **`PairVault.deposit` / `withdraw` / `redeem`** (ERC-4626)                   |
| **Borrower** | Posts DEX LP NFT     | Borrows USDC from the **same pair** only           | `borrowWithCollateral` / `repay` / `repayAndWithdraw` / `withdrawCollateral` |

Each pair has an **isolated** book on `MarketLendingModule` **and** a dedicated **`PairVault`** holding idle USDC.

**V4 note:** DEX V4 ETH pools use native ETH (`address(0)`). `V4Adapter` maps that to WETH for pair id, valuation, and liquidation.

```text
Lender   → PairVault.deposit(USDC)     → ERC-4626 shares
Market   → vault.pullLiquidity         → borrower on borrow
Borrower → repay                       → market.pushLiquidity → vault
Lender   → vault.withdraw / redeem     → idle USDC only
```

`MarketLendingModule.lendUsdc` / `withdrawLender` are deprecated and revert — use the vault.

## Debt asset

**Circle Sepolia USDC** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 decimals).

## Contracts

| Contract                 | Role                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `PairVault`              | ERC-4626; idle USDC; `totalAssets` = idle + principal/interest owed     |
| `MarketLendingModule`    | Loans, LTV, liquidate; `vaultOf[pairId]`; `feeTo` + `liquidationFeeBps` |
| `BorrowRateConfig`       | Per-pair borrow APR                                                     |
| `StaticApySource`        | Lender APY display (UI)                                                 |
| `CreLiquidationReceiver` | CRE → `liquidate`                                                       |

## Liquidity, yield & fees

- Utilization capped per pool (`maxUtilizationBps`, default 80%)
- Available cash = vault `idleAssets()` (not market balance)
- Lender yield = share of accrued borrower interest
- **Liquidation fee:** `liquidationFeeBps` of surplus → `feeTo` (separate from Ownable owner); remainder → borrower

## Sepolia

```bash
cd smart-contracts
npx hardhat run scripts/redeploy-market-per-pair-sepolia.js --network sepolia
```

1. Lender: approve USDC → `PairVault.deposit(assets, receiver)`
2. Borrower: approve NFT → `borrowWithCollateral(version, tokenId, amount)`
3. `previewBorrow` returns pairId, APR, APY, max borrow, pool available
