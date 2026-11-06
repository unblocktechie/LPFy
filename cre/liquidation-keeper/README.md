# LPFY — CRE liquidation keeper

A Chainlink CRE cron workflow reads the liquidation receiver's `needsUpkeep()` view.

The staging and production settings define the Sepolia receiver address.

`workflow.ts` performs a read-only upkeep check against the configured receiver.
