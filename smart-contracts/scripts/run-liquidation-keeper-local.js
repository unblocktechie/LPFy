/**
 * Local liquidation keeper (admin path) — use while CRE CLI is not set up yet.
 * Polls MarketLendingModule.findFirstLiquidatableLoan and calls liquidate as owner.
 *
 *   npx hardhat run scripts/run-liquidation-keeper-local.js --network sepolia
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const DEPLOY = path.join(__dirname, "..", "deployments", "sepolia-markets.json");

async function main() {
  const [signer] = await ethers.getSigners();
  const prev = JSON.parse(fs.readFileSync(DEPLOY, "utf8"));
  const marketAddr = ethers.getAddress(prev.contracts.marketLendingModule);

  const market = await ethers.getContractAt("MarketLendingModule", marketAddr);
  const owner = await market.owner();
  console.log("Signer:", signer.address);
  console.log("Market:", marketAddr);
  console.log("Owner:", owner);

  if (signer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Connect the market owner key in hardhat.config / .env to liquidate");
  }

  const [found, loanId] = await market.findFirstLiquidatableLoan();
  console.log("findFirstLiquidatableLoan →", { found, loanId: loanId.toString() });

  if (!found || loanId === 0n) {
    console.log("Nothing to liquidate.");
    return;
  }

  const preview = await market.previewLiquidation(loanId);
  console.log("preview:", {
    liquidatable: preview.liquidatable,
    estimatedUsdc: preview.estimatedUsdc.toString(),
    debt: preview.debt.toString(),
    shortfall: preview.shortfall.toString(),
  });

  const tx = await market.liquidate(loanId);
  console.log("liquidate tx:", tx.hash);
  await tx.wait();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
