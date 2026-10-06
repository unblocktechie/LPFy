/**
 * Web RPC URLs — `web/.env` only (VITE_*).
 * Independent from root Hardhat `.env` and CRE `cre/.env`.
 */
function read(key: string): string {
	return (import.meta.env[key] as string | undefined)?.trim() || "";
}

export const RPC_URLS = {
	sepolia: read("VITE_SEPOLIA_RPC_URL"),
	mainnet: read("VITE_MAINNET_RPC_URL"),
	localhost: read("VITE_LOCALHOST_RPC_URL") || "http://127.0.0.1:8545",
} as const;

export type RpcChain = keyof typeof RPC_URLS;

export function requireRpc(chain: RpcChain): string {
	const url = RPC_URLS[chain];
	if (!url) {
		throw new Error(
			`Missing RPC for ${chain}. Set VITE_${chain.toUpperCase()}_RPC_URL in web/.env`,
		);
	}
	return url;
}
