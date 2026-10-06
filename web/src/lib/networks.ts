import { type Address } from "viem";
import { sepolia } from "wagmi/chains";
import { V4_ADDRESSES } from "./v4Addresses";

/**
 * Sepolia markets stack (two-sided: lend/borrow Circle USDC against LP NFTs).
 * Addresses from deployments/sepolia-markets.json
 */
function envAddress(value: string | undefined, fallback: Address): Address {
  const raw = value?.trim();
  if (raw && /^0x[a-fA-F0-9]{40}$/.test(raw)) return raw as Address;
  return fallback;
}

export const SEPOLIA_WETH =
  "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as Address;
export const SEPOLIA_CIRCLE_USDC =
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;

/** Debt asset — Circle Sepolia USDC. */
export const DEBT_ASSET = envAddress(
  import.meta.env.VITE_SEPOLIA_USDC ?? import.meta.env.VITE_SEPOLIA_PUSDC,
  SEPOLIA_CIRCLE_USDC
) as Address;

/** @deprecated use DEBT_ASSET / USDC — same Circle USDC address */
export const PUSDC = DEBT_ASSET;

/** Filled after enable-markets-pairs-sepolia (mock on Sepolia). */
export const SEPOLIA_USDT = envAddress(
  import.meta.env.VITE_SEPOLIA_USDT,
  "0xE699A7254f05f93a539120BA640bf2D1C87b48f1"
);
export const SEPOLIA_WBTC = envAddress(
  import.meta.env.VITE_SEPOLIA_WBTC,
  "0x65bBDdD937C4CE8aCf308c0787b857664616BC2c"
);

/** @deprecated keep export name for older UI bits */
export const USDC = SEPOLIA_CIRCLE_USDC;
export const USDT = SEPOLIA_USDT;

export const APP_NETWORK = {
  id: "sepolia" as const,
  label: "Sepolia",
  chainId: sepolia.id,
  /** MarketLendingModule — lender + borrower entrypoint */
  lendingModule: envAddress(
    import.meta.env.VITE_SEPOLIA_MARKET_MODULE,
    "0x749be3f09Bae7f32bfe0Ad55D705658615AeB6C2"
  ),
  whitelist: envAddress(
    import.meta.env.VITE_SEPOLIA_MARKET_MODULE,
    "0x749be3f09Bae7f32bfe0Ad55D705658615AeB6C2"
  ),
  oracle: envAddress(
    import.meta.env.VITE_SEPOLIA_ORACLE,
    "0x057Cf93d6E404171f1505503604FC670cdB5b0A9"
  ),
  v3Adapter: envAddress(
    import.meta.env.VITE_SEPOLIA_V3_ADAPTER,
    "0x651396c2e4FD4A35dA559203e848265711067DC4"
  ),
  v4Adapter: envAddress(
    import.meta.env.VITE_SEPOLIA_V4_ADAPTER,
    "0x4a9D2F51EA7A8553987E699b68BFE85c426278C9"
  ),
  borrowRateConfig: envAddress(
    import.meta.env.VITE_SEPOLIA_BORROW_RATES,
    "0x49b19f400559923C5325357074AD80Ee109f43b8"
  ),
  staticApySource: envAddress(
    import.meta.env.VITE_SEPOLIA_APY_SOURCE,
    "0x6CD7b7cEe61B395fC7A39353FfD5426ea2C454f8"
  ),
  debtAsset: DEBT_ASSET,
  debtAssets: [DEBT_ASSET] as const,
  debtSymbol: "USDC",
  debtDecimals: 6,
  v3Npm: "0x1238536071E1c677A632429e3655c799b22cDA52" as Address,
  v4Npm: V4_ADDRESSES.sepolia.positionManager,
  v4StateView: V4_ADDRESSES.sepolia.stateView,
  factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c" as Address,
  markets: [
    {
      id: "usdc-eth",
      pair: "USDC / WETH",
      tokenA: SEPOLIA_CIRCLE_USDC,
      tokenB: SEPOLIA_WETH,
      borrowAprBps: 600,
      lenderApyBps: 500,
      ltv: "50%",
      fee: "V3 / V4",
      note: "USDC/WETH (V3) or ETH/USDC (V4 native ETH). Borrow Circle USDC.",
      vault: envAddress(
        import.meta.env.VITE_SEPOLIA_VAULT_USDC_WETH,
        zeroAddressFallback()
      ),
    },
    {
      id: "usdc-usdt",
      pair: "USDC / USDT",
      tokenA: SEPOLIA_CIRCLE_USDC,
      tokenB: SEPOLIA_USDT,
      borrowAprBps: 500,
      lenderApyBps: 400,
      ltv: "50%",
      fee: "V3 / V4",
      note: "Stable LP collateral. Borrow USDC at 5% APR.",
      vault: envAddress(
        import.meta.env.VITE_SEPOLIA_VAULT_USDC_USDT,
        zeroAddressFallback()
      ),
    },
    {
      id: "usdc-wbtc",
      pair: "USDC / WBTC",
      tokenA: SEPOLIA_CIRCLE_USDC,
      tokenB: SEPOLIA_WBTC,
      borrowAprBps: 650,
      lenderApyBps: 550,
      ltv: "50%",
      fee: "V3 / V4",
      note: "USDC/WBTC LP NFT collateral. Borrow USDC at 6.5% APR.",
      vault: envAddress(
        import.meta.env.VITE_SEPOLIA_VAULT_USDC_WBTC,
        zeroAddressFallback()
      ),
    },
  ],
} as const;

function zeroAddressFallback(): Address {
  return "0x0000000000000000000000000000000000000000";
}

export { V4_ADDRESSES };
export type AppNetworkId = typeof APP_NETWORK.id;
export type AppMarket = (typeof APP_NETWORK.markets)[number];
