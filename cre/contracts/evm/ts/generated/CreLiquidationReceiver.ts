// Minimal CRE client for CreLiquidationReceiver (same pattern as generated KeeperConsumer).
import {
  decodeFunctionResult,
  encodeFunctionData,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import {
  bytesToHex,
  encodeCallMsg,
  EVMClient,
  LATEST_BLOCK_NUMBER,
  prepareReportRequest,
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

  needsUpkeep(runtime: Runtime): { upkeepNeeded: boolean; loanId: bigint } {
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

  /** Writes abi-encoded report bytes to onReport via KeystoneForwarder. */
  writeReport(
    runtime: Runtime,
    callData: Hex,
    gasConfig?: { gasLimit?: string },
  ) {
    const reportResponse = runtime.report(prepareReportRequest(callData)).result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }
}
