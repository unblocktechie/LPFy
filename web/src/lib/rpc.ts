export const RPC_URLS = {
  sepolia: (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined)?.trim() || '',
  localhost: (import.meta.env.VITE_LOCALHOST_RPC_URL as string | undefined)?.trim() || 'http://127.0.0.1:8545',
} as const;

export type RpcChain = keyof typeof RPC_URLS;

export function requireRpc(chain: RpcChain): string {
  const url = RPC_URLS[chain];
  if (!url) throw new Error(`Missing RPC for ${chain}`);
  return url;
}
