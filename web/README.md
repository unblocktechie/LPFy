# Web — LPFY Markets

React + Vite application shell for LPFY Markets. The web provides wallet connectivity, network awareness, shared transaction state, project branding, and the base layout used by the protocol interface.

## Technology

- React 18
- TypeScript
- Vite
- wagmi + viem
- TanStack Query
- React Router

## Features

- Wallet connection and disconnection through wagmi connectors
- Active-chain detection and network switching
- Shared network and RPC configuration
- Transaction context and loading states
- Responsive LPFY application shell and visual assets
- Netlify SPA configuration

## Run locally

```bash
cd web
cp .env.example .env
npm ci
npm run dev
```

Vite serves the application at `http://localhost:5173` by default.

## Environment

Web configuration is read from `web/.env`. Start from `.env.example` and provide the RPC endpoints and deployed contract addresses for the selected network.

```env
VITE_NETWORK=sepolia
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
VITE_SEPOLIA_MARKET_MODULE=
VITE_SEPOLIA_ORACLE=
VITE_SEPOLIA_V3_ADAPTER=
VITE_SEPOLIA_V4_ADAPTER=
VITE_SEPOLIA_USDC=
```

Restart the Vite development server after changing environment variables.

## Source layout

```text
src/
├── App.tsx
├── main.tsx
├── layout/AppShell.tsx
├── providers/NetworkProvider.tsx
├── hooks/tx.tsx
├── lib/                  # Network, RPC, formatting and shared configuration
├── components/           # Shared UI components
└── assets/               # LPFY visual assets
```

## Build

```bash
npm run build
npm run preview
```

Deployment settings for Netlify are defined in `netlify.toml`.
