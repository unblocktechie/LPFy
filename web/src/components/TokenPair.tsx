import type { Address } from 'viem';
import { resolveSymbol } from '../lib/tokens';

export function TokenPair({ token0, token1 }: { token0?: Address; token1?: Address }) {
  if (!token0 && !token1) return <span className="pair-name muted">Pair unavailable</span>;
  const s0 = resolveSymbol(token0, undefined, token0 ? 'token0' : '—');
  const s1 = resolveSymbol(token1, undefined, token1 ? 'token1' : '—');
  return <span className="pair-name">{s0} / {s1}</span>;
}
