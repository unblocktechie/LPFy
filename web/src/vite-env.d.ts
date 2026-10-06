/// <reference types="vite/client" />

declare module "@lpfi-mark" {
  const src: string;
  export default src;
}

declare module "@lpfi-wordmark" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_NETWORK?: string;
  readonly VITE_SEPOLIA_RPC_URL?: string;
  readonly VITE_MAINNET_RPC_URL?: string;
  readonly VITE_LOCALHOST_RPC_URL?: string;
  readonly VITE_SEPOLIA_MARKET_MODULE?: string;
  readonly VITE_SEPOLIA_ORACLE?: string;
  readonly VITE_SEPOLIA_V3_ADAPTER?: string;
  readonly VITE_SEPOLIA_V4_ADAPTER?: string;
  readonly VITE_SEPOLIA_USDC?: string;

  readonly VITE_SEPOLIA_BORROW_RATES?: string;
  readonly VITE_SEPOLIA_APY_SOURCE?: string;
  readonly VITE_SEPOLIA_USDT?: string;
  readonly VITE_SEPOLIA_WBTC?: string;
  readonly VITE_SEPOLIA_CRE_RECEIVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
