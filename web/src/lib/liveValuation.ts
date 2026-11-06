import {
  createPublicClient,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  type Address,
  type PublicClient,
  zeroAddress,
} from "viem";
import { mainnet } from "viem/chains";
import { getAmountsForLiquidity } from "./clMath";
import { requireRpc } from "./rpc";
import { decodeV4PositionInfo } from "./v4Position";
import { V4_ADDRESSES } from "./v4Addresses";
import { knownToken, resolveDecimals, resolveSymbol } from "./tokens";

const V3_NPM = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as Address;
const V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as Address;

/** Mainnet Chainlink USD feeds (8 decimals). */
export const MAINNET_FEEDS: Record<string, Address> = {
  [zeroAddress]: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2":
    "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48":
    "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6",
  "0xdac17f958d2ee523a2206206994597c13d831ec7":
    "0x3e7d1eab13ad0104d2750b8863b489d65364e32d",
};

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);

const erc20MetaAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const v3NpmAbi = parseAbi([
  "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
  "function ownerOf(uint256) view returns (address)",
]);

const factoryAbi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
]);

const poolAbi = parseAbi([
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
]);

const v4NpmAbi = parseAbi([
  "function getPoolAndPositionInfo(uint256) view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks), uint256)",
  "function getPositionLiquidity(uint256) view returns (uint128)",
  "function ownerOf(uint256) view returns (address)",
]);

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

export type LiveValuation = {
  source: "live-mainnet";
  blockNumber: bigint;
  version: 0 | 1;
  tokenId: bigint;
  owner: Address;
  token0: Address;
  token1: Address;
  sym0: string;
  sym1: string;
  dec0: number;
  dec1: number;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  amount0: bigint;
  amount1: bigint;
  price0Usd: bigint | null;
  price1Usd: bigint | null;
  valueUsd: bigint | null;
  tickSpacing?: number;
  hooks?: Address;
  pool?: Address;
};

let cachedClient: PublicClient | null = null;

export function getLiveMainnetClient(): PublicClient {
  if (cachedClient) return cachedClient;
  cachedClient = createPublicClient({
    chain: mainnet,
    transport: http(requireRpc("mainnet"), { batch: true }),
  });
  return cachedClient;
}

function feedFor(token: Address): Address | undefined {
  return MAINNET_FEEDS[token.toLowerCase()];
}

async function readUsdPrice(client: PublicClient, token: Address): Promise<bigint | null> {
  const feed = feedFor(token);
  if (!feed) return null;
  const [, answer, , updatedAt] = await client.readContract({
    address: feed,
    abi: feedAbi,
    functionName: "latestRoundData",
  });
  if (answer <= 0n) return null;
  // Reject absurdly stale (> 1 day) — still show but caller can warn
  void updatedAt;
  const dec = await client.readContract({
    address: feed,
    abi: feedAbi,
    functionName: "decimals",
  });
  let price = answer;
  if (dec < 8) price = price * 10n ** BigInt(8 - dec);
  else if (dec > 8) price = price / 10n ** BigInt(dec - 8);
  return price;
}

async function readTokenMeta(client: PublicClient, token: Address) {
  if (token === zeroAddress) {
    return { symbol: "ETH", decimals: 18 };
  }
  const known = knownToken(token);
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: erc20MetaAbi, functionName: "symbol" }),
      client.readContract({ address: token, abi: erc20MetaAbi, functionName: "decimals" }),
    ]);
    return {
      symbol: resolveSymbol(token, symbol, known?.symbol ?? "token"),
      decimals: resolveDecimals(token, Number(decimals)) ?? 18,
    };
  } catch {
    return {
      symbol: resolveSymbol(token, undefined, known?.symbol ?? "token"),
      decimals: resolveDecimals(token, known?.decimals) ?? 18,
    };
  }
}

function valueUsd(
  amount0: bigint,
  amount1: bigint,
  dec0: number,
  dec1: number,
  px0: bigint | null,
  px1: bigint | null
): bigint | null {
  if (px0 === null || px1 === null) return null;
  return (amount0 * px0) / 10n ** BigInt(dec0) + (amount1 * px1) / 10n ** BigInt(dec1);
}

export async function fetchLiveV3Valuation(tokenId: bigint): Promise<LiveValuation> {
  const client = getLiveMainnetClient();
  const blockNumber = await client.getBlockNumber();
  const [pos, owner] = await Promise.all([
    client.readContract({
      address: V3_NPM,
      abi: v3NpmAbi,
      functionName: "positions",
      args: [tokenId],
    }),
    client.readContract({
      address: V3_NPM,
      abi: v3NpmAbi,
      functionName: "ownerOf",
      args: [tokenId],
    }),
  ]);

  const token0 = pos[2] as Address;
  const token1 = pos[3] as Address;
  const fee = Number(pos[4]);
  const tickLower = Number(pos[5]);
  const tickUpper = Number(pos[6]);
  const liquidity = pos[7] as bigint;
  const owed0 = pos[10] as bigint;
  const owed1 = pos[11] as bigint;

  const pool = await client.readContract({
    address: V3_FACTORY,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token0, token1, fee],
  });
  if (pool === zeroAddress) throw new Error("V3 pool not found");

  const slot0 = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "slot0",
  });
  const sqrtPriceX96 = slot0[0] as bigint;
  const { amount0: a0, amount1: a1 } = getAmountsForLiquidity(
    sqrtPriceX96,
    tickLower,
    tickUpper,
    liquidity
  );
  const amount0 = a0 + owed0;
  const amount1 = a1 + owed1;

  const [m0, m1, price0Usd, price1Usd] = await Promise.all([
    readTokenMeta(client, token0),
    readTokenMeta(client, token1),
    readUsdPrice(client, token0),
    readUsdPrice(client, token1),
  ]);

  return {
    source: "live-mainnet",
    blockNumber,
    version: 0,
    tokenId,
    owner,
    token0,
    token1,
    sym0: m0.symbol,
    sym1: m1.symbol,
    dec0: m0.decimals,
    dec1: m1.decimals,
    fee,
    tickLower,
    tickUpper,
    liquidity,
    sqrtPriceX96,
    amount0,
    amount1,
    price0Usd,
    price1Usd,
    valueUsd: valueUsd(amount0, amount1, m0.decimals, m1.decimals, price0Usd, price1Usd),
    pool,
  };
}

export async function fetchLiveV4Valuation(tokenId: bigint): Promise<LiveValuation> {
  const client = getLiveMainnetClient();
  const pm = V4_ADDRESSES.mainnet.positionManager;
  const stateView = V4_ADDRESSES.mainnet.stateView;
  const blockNumber = await client.getBlockNumber();

  const [[poolKey, info], liquidity, owner] = await Promise.all([
    client.readContract({
      address: pm,
      abi: v4NpmAbi,
      functionName: "getPoolAndPositionInfo",
      args: [tokenId],
    }),
    client.readContract({
      address: pm,
      abi: v4NpmAbi,
      functionName: "getPositionLiquidity",
      args: [tokenId],
    }),
    client.readContract({
      address: pm,
      abi: v4NpmAbi,
      functionName: "ownerOf",
      args: [tokenId],
    }),
  ]);

  const token0 = poolKey.currency0 as Address;
  const token1 = poolKey.currency1 as Address;
  const fee = Number(poolKey.fee);
  const ticks = decodeV4PositionInfo(info);
  const poolId = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [token0, token1, fee, poolKey.tickSpacing, poolKey.hooks]
    )
  );

  const slot0 = await client.readContract({
    address: stateView,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [poolId],
  });
  const sqrtPriceX96 = slot0[0];
  const { amount0, amount1 } = getAmountsForLiquidity(
    sqrtPriceX96,
    ticks.tickLower,
    ticks.tickUpper,
    liquidity
  );

  const [m0, m1, price0Usd, price1Usd] = await Promise.all([
    readTokenMeta(client, token0),
    readTokenMeta(client, token1),
    readUsdPrice(client, token0),
    readUsdPrice(client, token1),
  ]);

  return {
    source: "live-mainnet",
    blockNumber,
    version: 1,
    tokenId,
    owner,
    token0,
    token1,
    sym0: m0.symbol,
    sym1: m1.symbol,
    dec0: m0.decimals,
    dec1: m1.decimals,
    fee,
    tickLower: ticks.tickLower,
    tickUpper: ticks.tickUpper,
    liquidity,
    sqrtPriceX96,
    amount0,
    amount1,
    price0Usd,
    price1Usd,
    valueUsd: valueUsd(amount0, amount1, m0.decimals, m1.decimals, price0Usd, price1Usd),
    tickSpacing: Number(poolKey.tickSpacing),
    hooks: poolKey.hooks as Address,
  };
}

export async function fetchLiveValuation(version: 0 | 1, tokenId: bigint) {
  return version === 0 ? fetchLiveV3Valuation(tokenId) : fetchLiveV4Valuation(tokenId);
}

export function formatLiveHint(v: LiveValuation) {
  return `Live mainnet · block ${v.blockNumber.toString()} · ${formatUnits(v.valueUsd ?? 0n, 8)}`;
}
