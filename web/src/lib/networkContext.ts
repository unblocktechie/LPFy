import { createContext, useContext } from "react";
import type { Address } from "viem";
import { getAddress, zeroAddress } from "viem";
import { APP_NETWORK } from "./networks";

export type NetworkState = {
  networkId: typeof APP_NETWORK.id;
  chainId: number;
  label: string;
  addresses: {
    lendingModule: Address;
    whitelist: Address;
    oracle: Address;
    v3Adapter: Address;
    v4Adapter: Address;
    debtAsset: Address;
    v3Npm: Address;
    v4Npm: Address;
    factory: Address;
    borrowRateConfig: Address;
    staticApySource: Address;
  };
  debtAssets: readonly Address[];
  setDebtAsset: (asset: Address) => void;
  markets: typeof APP_NETWORK.markets;
  contractsConfigured: boolean;
};

export function buildNetworkState(
  selectedDebt: Address | undefined,
  setDebtAsset: (asset: Address) => void
): NetworkState {
  const n = APP_NETWORK;
  const allowed = n.debtAssets;
  let debtAsset: Address = n.debtAsset;
  if (selectedDebt) {
    try {
      const sel = getAddress(selectedDebt);
      if (allowed.some((a) => getAddress(a) === sel)) debtAsset = sel as Address;
    } catch {
      /* keep default */
    }
  }
  const addresses = {
    lendingModule: n.lendingModule,
    whitelist: n.whitelist,
    oracle: n.oracle,
    v3Adapter: n.v3Adapter,
    v4Adapter: n.v4Adapter,
    debtAsset,
    v3Npm: n.v3Npm,
    v4Npm: n.v4Npm,
    factory: n.factory,
    borrowRateConfig: n.borrowRateConfig,
    staticApySource: n.staticApySource,
  };
  return {
    networkId: n.id,
    chainId: n.chainId,
    label: n.label,
    addresses,
    debtAssets: allowed,
    setDebtAsset,
    markets: n.markets,
    contractsConfigured:
      addresses.lendingModule !== zeroAddress &&
      addresses.v3Adapter !== zeroAddress &&
      addresses.oracle !== zeroAddress,
  };
}

export const NetworkContext = createContext<NetworkState | null>(null);

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within NetworkProvider");
  return ctx;
}
