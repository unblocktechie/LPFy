/**
 * CRE liquidation keeper — cron → needsUpkeep → writeReport(loanId).
 * Pattern: https://github.com/smartcontractkit/cre-templates/.../keeper-bot-ts
 */
import {
  cre,
  getNetwork,
  type Runtime,
} from '@chainlink/cre-sdk'
import { type Address } from 'viem'
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

  runtime.log(`Liquidatable loan #${loanId.toString()} detected.`)
  return `Liquidatable loan ${loanId.toString()}`
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
