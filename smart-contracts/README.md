# Smart Contracts — LPFY Markets

Hardhat workspace for the LPFY Markets protocol contracts. This package contains the Solidity development environment, network configuration, shared path helpers, and dependency setup used by the protocol.

## Technology

- Solidity `0.8.24`
- Hardhat
- OpenZeppelin Contracts
- dotenv-based network configuration

## Setup

```bash
cd smart-contracts
cp .env.example .env
npm ci
npm run compile
```

Configure the required RPC endpoints and deployment credentials in `.env` using `.env.example` as the reference.

## Project structure

```text
smart-contracts/
├── config/
│   ├── paths.js          # Shared repository paths
│   └── rpc.js            # RPC configuration
├── contracts/            # Solidity sources
├── hardhat.config.js     # Hardhat compiler and network configuration
├── package.json
└── .env.example
```

## Commands

```bash
npm run compile     # Compile Solidity contracts
npm test            # Run the Hardhat test suite
```

The Hardhat configuration centralizes compiler settings and network access so contract development and deployment scripts can share the same environment.
