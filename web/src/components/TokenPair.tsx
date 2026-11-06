import type { Address } from 'viem';
import { resolveSymbol } from '../lib/tokens';

export function TokenPair({ token0, token1 }: { token0?: Address; token1?: Address }) {
  if (!token0 && !token1) return <span className="pair-name muted">Pair unavailable</span>;
  const s0 = resolveSymbol(token0, undefined, token0 ? 'token0' : '—');
  const s1 = resolveSymbol(token1, undefined, token1 ? 'token1' : '—');
  return <span className="token-pair">
    <span className="token-pair-icons" aria-hidden="true">
      <span className="token-icon">{s0.slice(0, 2).toUpperCase()}</span>
      <span className="token-icon">{s1.slice(0, 2).toUpperCase()}</span>
    </span>
    <span className="pair-name">{s0} / {s1}</span>
  </span>;
}
