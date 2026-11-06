import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient } from "@tanstack/react-query";
import { http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { WALLETCONNECT_ID } from "./lib/constants";
import { requireRpc } from "./lib/rpc";

/**
 * WalletConnect Cloud project id (https://cloud.walletconnect.com).
 * Required for WalletConnect / mobile wallets. Injected wallets still work without it.
 */
const projectId =
  WALLETCONNECT_ID?.trim() ||
  "00000000000000000000000000000000";

if (!WALLETCONNECT_ID?.trim()) {
  console.warn(
    "[LPFY] Set VITE_WALLETCONNECT_ID in web/.env for WalletConnect / RainbowKit mobile wallets. Get a free id at https://cloud.walletconnect.com",
  );
}

/** App targets Sepolia only (VITE_NETWORK / APP_NETWORK). */
export const config = getDefaultConfig({
  appName: "LPFY Markets",
  projectId,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(requireRpc("sepolia")),
  },
  ssr: false,
});

export const queryClient = new QueryClient();
