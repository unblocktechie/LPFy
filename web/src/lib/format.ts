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
