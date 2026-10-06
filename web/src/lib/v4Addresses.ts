import { type Address } from "viem";

/**
 * Official Uniswap V4 periphery deployments.
 * https://developers.uniswap.org/docs/protocols/v4/deployments
 */
export const V4_ADDRESSES = {
  mainnet: {
    positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e" as Address,
    stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227" as Address,
  },
  sepolia: {
    positionManager: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4" as Address,
    stateView: "0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c" as Address,
  },
} as const;
