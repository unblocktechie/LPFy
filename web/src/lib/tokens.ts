import { getAddress, type Address } from 'viem';

const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  '0xfff9976782d46cc05630d1f6ebab18b2324d6b14': { symbol: 'WETH', decimals: 18 },
  '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': { symbol: 'USDC', decimals: 6 },
};

export function resolveSymbol(addr: Address | undefined, onChain?: string, fallback = 'token') {
  if (onChain) return onChain;
  if (!addr) return fallback;
  return TOKENS[getAddress(addr).toLowerCase()]?.symbol ?? fallback;
}
