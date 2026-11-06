// Minimal CRE client for CreLiquidationReceiver (same pattern as generated KeeperConsumer).
import {
  decodeFunctionResult,
  encodeFunctionData,
  zeroAddress,
  type Address,
} from 'viem'
import {
  bytesToHex,
  encodeCallMsg,
  EVMClient,
  LATEST_BLOCK_NUMBER,
  type Runtime,
} from '@chainlink/cre-sdk'

export const CreLiquidationReceiverABI = [
  {
    type: 'function',
    name: 'needsUpkeep',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'upkeepNeeded', type: 'bool' },
      { name: 'loanId', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'onReport',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'metadata', type: 'bytes' },
      { name: 'report', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'forwarder',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'market',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export class CreLiquidationReceiver {
  constructor(
    private readonly client: EVMClient,
    public readonly address: Address,
  ) {}

  needsUpkeep(runtime: Runtime<unknown>): { upkeepNeeded: boolean; loanId: bigint } {
    const callData = encodeFunctionData({
      abi: CreLiquidationReceiverABI,
      functionName: 'needsUpkeep',
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: this.address,
          data: callData,
        }),
        // Latest: newly redeployed receivers have no code at finalized yet.
        // Keepers also want the freshest liquidatable state.
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result()

    const decoded = decodeFunctionResult({
      abi: CreLiquidationReceiverABI,
      functionName: 'needsUpkeep',
      data: bytesToHex(result.data),
    }) as readonly [boolean, bigint]

    return { upkeepNeeded: decoded[0], loanId: decoded[1] }
  }
}
