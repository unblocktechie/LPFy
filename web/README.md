# Frontend — LPFY Markets

React + Vite interface for LPFY Markets. The application connects to the deployed lending contracts and provides market discovery, ERC-4626 supply flows, LP-NFT-backed borrowing, pool liquidity metrics, and wallet position management.

## Technology

- React 18 + TypeScript
- Vite
- wagmi + viem
- TanStack Query
- React Router

## Application flows

### Markets

The Markets view presents configured lending pairs with live contract data including cash, utilization, lender APY, borrow APR, and pair configuration.

### Supply

Lenders supply the configured debt asset through pair-specific ERC-4626 vaults. The interface reads vault balances and protocol liquidity and submits approval/deposit transactions through the shared transaction layer.

### Borrow

Borrowers can select supported Uniswap V3 or V4 LP NFT positions, preview borrowing capacity, approve the position manager, and open a loan against matching LP collateral.

### Assets

The Assets view reads the connected wallet's lending positions and loans, including vault shares, supplied assets, debt positions, and related transaction actions.

## Routes

| Route | Purpose |
|---|---|
| `/` or `/markets` | Browse lending markets and open a pair |
| `/markets/:marketId` | View a market and interact with supply/borrow flows |
| `/assets` | View the connected wallet's supplies and loans |

## Run locally

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:5173` and connect a wallet to the configured network.

## Environment

Use `.env.example` as the source for frontend RPC and contract configuration. Contract addresses should correspond to the deployment used by the connected network.

```env
VITE_NETWORK=sepolia
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_SEPOLIA_MARKET_MODULE=
VITE_SEPOLIA_ORACLE=
VITE_SEPOLIA_V3_ADAPTER=
VITE_SEPOLIA_V4_ADAPTER=
VITE_SEPOLIA_USDC=
VITE_SEPOLIA_BORROW_RATES=
VITE_SEPOLIA_APY_SOURCE=
```

## Source layout

```text
src/
├── features/
│   ├── markets/
│   ├── supply/
│   ├── borrow/
│   ├── loans/
│   ├── positions/
│   └── pool/
├── components/
├── hooks/
├── lib/
├── providers/
├── abi.ts
└── layout/AppShell.tsx
```

## Build

```bash
npm run build
npm run preview
```

Netlify deployment settings are defined in `netlify.toml`.
