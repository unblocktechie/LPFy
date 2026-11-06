import { formatUnits } from "viem";

export function shortAddr(addr?: string) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatUsd8(value?: bigint) {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, 8));
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function formatHealth(hfWad?: bigint) {
  if (hfWad === undefined) return "—";
  if (hfWad > 10n ** 36n) return "∞";
  const n = Number(hfWad) / 1e18;
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(2);
}

export function formatAmount(value: bigint | undefined, decimals: number) {
  if (value === undefined) return "—";
  if (value === 0n) return "0";
  if (decimals >= 4) {
    const min = 10n ** BigInt(decimals - 4);
    if (value > 0n && value < min) return "<0.0001";
  }
  const n = Number(formatUnits(value, decimals));
  if (!Number.isFinite(n)) return formatUnits(value, decimals);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Pegged stables: convert debt amount into USD 1e8 for display. */
export function debtAmountToUsd8(amount: bigint | undefined, decimals: number) {
  if (amount === undefined) return undefined;
  if (decimals >= 8) return amount / 10n ** BigInt(decimals - 8);
  return amount * 10n ** BigInt(8 - decimals);
}

export function versionLabel(v: number) {
  return v === 0 ? "Uniswap V3" : "Uniswap V4";
}

/** Uniswap fee tier: 500 → 0.05%, 3000 → 0.3%. */
export function formatPoolFee(fee?: number | bigint) {
  if (fee === undefined) return undefined;
  const n = Number(fee);
  if (!Number.isFinite(n)) return undefined;
  return `${(n / 10_000).toFixed(2)}%`;
}

export function formatLtvBps(bps?: number | bigint) {
  if (bps === undefined) return undefined;
  return `${Number(bps) / 100}%`;
}
