/**
 * CRE liquidation keeper — cron → needsUpkeep → writeReport(loanId).
 * Pattern: https://github.com/smartcontractkit/cre-templates/.../keeper-bot-ts
 */
import {
  bytesToHex,
  cre,
  getNetwork,
  TxStatus,
  type Runtime,
} from '@chainlink/cre-sdk'
import { type Address, encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { CreLiquidationReceiver } from './contracts/CreLiquidationReceiver'

export const configSchema = z.object({
  schedule: z.string(),
  evms: z.array(
    z.object({
      chainSelectorName: z.string(),
      /** CreLiquidationReceiver on Sepolia */
      contractAddress: z.string(),
    }),
  ),
})

type Config = z.infer<typeof configSchema>

export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const evmConfig = runtime.config.evms[0]

  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: evmConfig.chainSelectorName,
    isTestnet: true,
  })
  if (!network) {
    throw new Error(`Network not found: ${evmConfig.chainSelectorName}`)
  }

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const receiver = new CreLiquidationReceiver(
    evmClient,
    evmConfig.contractAddress as Address,
  )

  const { upkeepNeeded, loanId } = receiver.needsUpkeep(runtime)
  runtime.log(`needsUpkeep=${upkeepNeeded} loanId=${loanId.toString()}`)

  if (!upkeepNeeded || loanId === 0n) {
    runtime.log('No liquidatable loan. Skipping.')
    return 'Skipped — no upkeep needed'
  }

  // Payload decoded by CreLiquidationReceiver.onReport → market.liquidate(loanId)
  const reportData = encodeAbiParameters(parseAbiParameters('uint256 loanId'), [
    loanId,
  ])

  // Liquidation (unwind + swaps) needs ~600k+; Forwarder verification also costs gas.
  // Default sim gas is too tight → ReportProcessed(false) while outer tx still "succeeds".
  const writeResult = receiver.writeReport(runtime, reportData, {
    gasLimit: '3500000',
  })

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(
      `Liquidation TX failed: ${writeResult.errorMessage || writeResult.txStatus}`,
    )
  }

  if (
    writeResult.receiverContractExecutionStatus !== undefined &&
    writeResult.receiverContractExecutionStatus !== 0
  ) {
    throw new Error(
      `Receiver execution failed: status ${writeResult.receiverContractExecutionStatus} (liquidate reverted — often swap/gas). Check ReportProcessed.result on explorer.`,
    )
  }

  const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
  runtime.log(`Liquidated loan #${loanId.toString()}. TX: ${txHash}`)
  return `Liquidated loan ${loanId.toString()} — tx: ${txHash}`
}

export function initWorkflow(config: Config) {
  const cronTrigger = new cre.capabilities.CronCapability()
  return [
    cre.handler(
      cronTrigger.trigger({ schedule: config.schedule }),
      onCronTrigger,
    ),
  ]
}
