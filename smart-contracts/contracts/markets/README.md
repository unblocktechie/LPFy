# Markets — Uniswap LP NFT lending (per-pair)

Two-sided books: lenders supply USDC; borrowers post **Uniswap V3 / V4 LP NFTs** as collateral.

## Roles

| Role | Who | What they do | Main functions |
|------|-----|--------------|----------------|
| **Lender** | Supplies Circle USDC | Earns from borrower interest via vault share price | **`PairVault.deposit` / `withdraw` / `redeem`** (ERC-4626) |
| **Borrower** | Posts Uniswap V3/V4 LP NFT | Borrows USDC from the **same pair** only | `borrowWithCollateral` / `repay` / `repayAndWithdraw` / `withdrawCollateral` |

Each pair has an **isolated** book on `MarketLendingModule` **and** a dedicated **`PairVault`** holding idle USDC. Uniswap adapters (`V3Adapter` / `V4Adapter`) custody the LP NFTs; liquidation swaps use **SwapRouter02**.

**V4 note:** Uniswap V4 ETH pools use native ETH (`address(0)`). `V4Adapter` maps that to WETH for pair id, valuation, and liquidation.

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

| Contract | Role |
|----------|------|
| `PairVault` | ERC-4626; idle USDC; `totalAssets` = idle + principal/interest owed |
| `MarketLendingModule` | Loans, LTV, liquidate; Uniswap unwind + `_swapToUsdc`; `vaultOf[pairId]`; `feeTo` + `liquidationFeeBps` |
| `FeeFallbackSwapRouter` | Optional SwapRouter02 wrapper (fee-tier retries for V4 fees) |
| `BorrowRateConfig` | Per-pair borrow APR |
| `StaticApySource` | Lender APY display (UI) |
| `CreLiquidationReceiver` | CRE → `liquidate` |

## Liquidity, yield & fees

- Utilization capped per pool (`maxUtilizationBps`, default 80%)
- Available cash = vault `idleAssets()` (not market balance)
- Lender yield = share of accrued borrower interest (see [Project Overview](../../../docs/Project_Overview.pdf))
- **Liquidation fee:** `liquidationFeeBps` of surplus → `feeTo` (separate from Ownable owner); remainder → borrower

## Sepolia

```bash
cd smart-contracts
npx hardhat run scripts/redeploy-market-per-pair-sepolia.js --network sepolia
```

1. Lender: approve USDC → `PairVault.deposit(assets, receiver)`
2. Borrower: approve NFT → `borrowWithCollateral(version, tokenId, amount)`
3. `previewBorrow` returns pairId, APR, APY, max borrow, pool available
