/**
 * Set MarketLendingModule.liquidationFeeBps
 *
 *   LIQUIDATION_FEE_BPS=1000 npx hardhat run scripts/set-liquidation-fee.js --network sepolia
 *
 * 1000 = 10% of liquidation surplus (after debt repaid to vault).
 * Optional: MARKET_MODULE=0x... (defaults to deployments/sepolia-markets.json)
 */
require("dotenv").config();
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile } = require("../config/paths");

async function main() {
  const bps = Number(process.env.LIQUIDATION_FEE_BPS ?? "1000");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error("LIQUIDATION_FEE_BPS must be an integer 0..10000");
  }

  const prev = JSON.parse(fs.readFileSync(deploymentFile("sepolia-markets.json"), "utf8"));
  const marketAddr = ethers.getAddress(
    process.env.MARKET_MODULE || prev.contracts.marketLendingModule,
  );

  const [signer] = await ethers.getSigners();
  const market = await ethers.getContractAt("MarketLendingModule", marketAddr, signer);
  const owner = await market.owner();
  const before = await market.liquidationFeeBps();

  console.log("Market:", marketAddr);
  console.log("Signer:", signer.address);
  console.log("Owner:", owner);
  console.log("Before:", before.toString(), `(${Number(before) / 100}%)`);

  if (signer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Signer is not market owner");
  }

  const tx = await market.setLiquidationFeeBps(bps);
  console.log("Tx:", tx.hash);
  await tx.wait();

  const after = await market.liquidationFeeBps();
  console.log("After:", after.toString(), `(${Number(after) / 100}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
