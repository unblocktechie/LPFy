# Web — LPFY Markets

React + Vite interface for LPFY Markets with wallet/network integration and live pool-liquidity data from the lending contracts.

## Technology

- React 18 + TypeScript
- Vite
- wagmi + viem
- TanStack Query
- React Router

## Pool liquidity

The Markets view reads protocol liquidity directly from `MarketLendingModule` for the configured market pairs. It displays:

- total available borrowing liquidity
- pool cash balance
- utilization
- aggregated values across configured pairs

Contract reads are performed with wagmi using the ABI definitions in `src/abi.ts` and market configuration from the active network context.

## Wallet and network support

The application provides wallet connection, active-chain detection, network switching, shared transaction state, and RPC configuration through the common application shell.

## Run locally

```bash
cd web
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:5173` and connect a wallet to the configured network.

## Environment

Set the network RPC and deployed protocol addresses in `web/.env`. Use `.env.example` as the reference.

```env
VITE_NETWORK=sepolia
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_SEPOLIA_MARKET_MODULE=
VITE_SEPOLIA_USDC=
```

## Source layout

```text
src/
├── abi.ts
├── layout/AppShell.tsx
├── features/pool/PoolLiquidity.tsx
├── providers/NetworkProvider.tsx
├── hooks/tx.tsx
├── lib/
└── components/
```

## Build

```bash
npm run build
npm run preview
```

Netlify deployment settings are defined in `netlify.toml`.
