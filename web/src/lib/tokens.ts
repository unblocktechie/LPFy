import { type Address, getAddress } from "viem";

/** Well-known ERC-20 metadata (mainnet + common test tokens). */
const KNOWN: Record<string, { symbol: string; decimals: number; name: string }> = {
  "0x0000000000000000000000000000000000000000": {
    symbol: "ETH",
    decimals: 18,
    name: "Ether",
  },
  // Mainnet
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
  },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": {
    symbol: "USDT",
    decimals: 6,
    name: "Tether USD",
  },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    symbol: "WETH",
    decimals: 18,
    name: "Wrapped Ether",
  },
  "0x6b175474e89094c44da98b954eedeac495271d0f": {
    symbol: "DAI",
    decimals: 18,
    name: "Dai Stablecoin",
  },
  // Sepolia
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14": {
    symbol: "WETH",
    decimals: 18,
    name: "Wrapped Ether",
  },
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": {
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
  },
  "0x19359aa05ff73466e16515eb5c3347a711c49032": {
    symbol: "PUSDC",
    decimals: 18,
    name: "pUSDC",
  },
  "0xe699a7254f05f93a539120ba640bf2d1c87b48f1": {
    symbol: "USDT",
    decimals: 6,
    name: "Tether USD",
  },
  "0x65bbddd937c4ce8acf308c0787b857664616bc2c": {
    symbol: "WBTC",
    decimals: 8,
    name: "Wrapped BTC",
  },
};

const LOGOS: Record<string, string> = {
  ETH: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  WETH: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png",
  USDC: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
  USDT: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png",
  DAI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png",
  WBTC: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png",
  PUSDC: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
};

export function tokenLogoUrl(addr?: Address | string, symbol?: string) {
  const sym = (knownToken(addr)?.symbol ?? symbol ?? "").toUpperCase();
  if (!sym) return undefined;
  return LOGOS[sym];
}

export function knownToken(addr?: Address | string) {
  if (!addr) return undefined;
  try {
    return KNOWN[getAddress(addr).toLowerCase()];
  } catch {
    return undefined;
  }
}

export function resolveSymbol(
  addr: Address | undefined,
  onChain?: string,
  fallback = "token"
) {
  if (onChain && onChain.length > 0) return onChain;
  return knownToken(addr)?.symbol ?? fallback;
}

export function resolveDecimals(addr: Address | undefined, onChain?: number) {
  const known = knownToken(addr)?.decimals;
  if (known !== undefined) return known;
  if (typeof onChain === "number" && Number.isFinite(onChain)) return onChain;
  return undefined;
}

/** Debt token decimals. Circle USDC is 6; unknown addresses default to 6. */
export function debtTokenDecimals(addr?: Address) {
  return resolveDecimals(addr) ?? 6;
}

export function formatBpsAsPct(bps: number | undefined) {
  if (bps === undefined) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}
