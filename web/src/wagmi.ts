import { QueryClient } from "@tanstack/react-query";
import { http, createConfig } from "wagmi";
import { hardhat, mainnet, sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { WALLETCONNECT_ID } from "./lib/constants";
import { requireRpc, RPC_URLS } from "./lib/rpc";

/** Mainnet-fork localhost: Multicall3 exists at the canonical address on forked state. */
const hardhatFork = {
  ...hardhat,
  contracts: {
    ...hardhat.contracts,
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const,
      blockCreated: 14353601,
    },
  },
} as const;

const connectors = [
  injected({ shimDisconnect: true }),
  ...(WALLETCONNECT_ID
    ? [
        walletConnect({
          projectId: WALLETCONNECT_ID,
          showQrModal: true,
        }),
      ]
    : []),
];

export const config = createConfig({
  chains: [sepolia, mainnet, hardhatFork],
  connectors,
  transports: {
    [mainnet.id]: http(requireRpc("mainnet")),
    [sepolia.id]: http(requireRpc("sepolia")),
    [hardhatFork.id]: http(RPC_URLS.localhost),
  },
});
export const queryClient = new QueryClient();
