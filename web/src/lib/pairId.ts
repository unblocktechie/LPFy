import { type Address, encodePacked, getAddress, keccak256, zeroAddress } from "viem";
import type { AppMarket } from "./networks";
import { SEPOLIA_WETH } from "./networks";

/**
 * Uniswap V4 uses native ETH (address(0)) in pool keys.
 * On-chain V4Adapter maps that to WETH for pairId / valuation / liquidation.
 * Keep the same mapping in the UI so ETH/USDC V4 NFTs match the USDC/WETH market.
 */
export function asMarketToken(token: Address | undefined): Address | undefined {
  if (!token) return undefined;
  if (token.toLowerCase() === zeroAddress) return SEPOLIA_WETH;
  return getAddress(token);
}

/** Canonical pair id matching on-chain PairId.id (tokenA < tokenB). */
export function pairIdOf(tokenA: Address, tokenB: Address): `0x${string}` {
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(encodePacked(["address", "address"], [x, y]));
}

function isUsdcEthPool(market: AppMarket): boolean {
  return market.poolKey === "usdc-eth" || market.id.startsWith("usdc-eth");
}

/** Lending pool id for a market (USDC/ETH uses WETH — same as V4 native ETH after mapping). */
export function marketPoolIds(market: AppMarket): {
  primary: `0x${string}`;
} {
  if (isUsdcEthPool(market)) {
    return {
      primary: pairIdOf(market.tokenA as Address, SEPOLIA_WETH),
    };
  }
  return {
    primary: pairIdOf(market.tokenA as Address, market.tokenB as Address),
  };
}

export function pairIdForPosition(
  market: AppMarket,
  token0?: Address,
  token1?: Address,
): `0x${string}` {
  const t0 = asMarketToken(token0);
  const t1 = asMarketToken(token1);
  if (t0 !== undefined && t1 !== undefined) {
    return pairIdOf(t0, t1);
  }
  return marketPoolIds(market).primary;
}

/** Unique isolated lending pool ids (V3/V4 UI rows share one on-chain pool). */
export function allMarketPairIds(
  markets: readonly AppMarket[],
): `0x${string}`[] {
  const seen = new Set<string>();
  const out: `0x${string}`[] = [];
  for (const m of markets) {
    const id = marketPoolIds(m).primary;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** True if LP token legs match a market (native ETH ≡ WETH). */
export function matchesMarketPair(
  token0: Address | undefined,
  token1: Address | undefined,
  market: AppMarket,
): boolean {
  const t0 = asMarketToken(token0);
  const t1 = asMarketToken(token1);
  if (!t0 || !t1) return false;
  const a = getAddress(market.tokenA as Address);
  const b = getAddress(market.tokenB as Address);
  return (
    (t0.toLowerCase() === a.toLowerCase() &&
      t1.toLowerCase() === b.toLowerCase()) ||
    (t0.toLowerCase() === b.toLowerCase() &&
      t1.toLowerCase() === a.toLowerCase())
  );
}
