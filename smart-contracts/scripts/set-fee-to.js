/**
 * Set MarketLendingModule.feeTo (liquidation fee recipient).
 *
 *   FEE_TO=0x... npx hardhat run scripts/set-fee-to.js --network sepolia
 *
 * Optional: MARKET_MODULE=0x... (defaults to deployments/sepolia-markets.json)
 */
require("dotenv").config();
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile } = require("../config/paths");

async function main() {
  const feeTo = process.env.FEE_TO;
  if (!feeTo || !ethers.isAddress(feeTo)) {
    throw new Error("Set FEE_TO to a valid address");
  }

  const prev = JSON.parse(fs.readFileSync(deploymentFile("sepolia-markets.json"), "utf8"));
  const marketAddr = ethers.getAddress(
    process.env.MARKET_MODULE || prev.contracts.marketLendingModule,
  );

  const [signer] = await ethers.getSigners();
  const market = await ethers.getContractAt("MarketLendingModule", marketAddr, signer);
  const owner = await market.owner();
  const before = await market.feeTo();

  console.log("Market:", marketAddr);
  console.log("Signer:", signer.address);
  console.log("Owner:", owner);
  console.log("feeTo before:", before);

  if (signer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Signer is not market owner");
  }

  const tx = await market.setFeeTo(feeTo);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("feeTo after:", await market.feeTo());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
