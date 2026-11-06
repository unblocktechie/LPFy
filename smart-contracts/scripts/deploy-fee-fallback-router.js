/**
 * Deploy FeeFallbackSwapRouter and point the live market at it.
 * Does not redeploy MarketLendingModule — uses setSwapRouter.
 *
 *   npx hardhat run scripts/deploy-fee-fallback-router.js --network sepolia
 *   npm run deploy:fee-router
 *
 * Optional:
 *   DRY_RUN=1          print plan only (default is broadcast on sepolia)
 *   INNER_ROUTER=0x...  default SwapRouter02 from sepolia-markets.json
 *   MARKET_MODULE=0x... default market from sepolia-markets.json
 */
require("dotenv").config();
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile } = require("../config/paths");

async function main() {
  const dry = process.env.DRY_RUN === "1";
  const prev = JSON.parse(fs.readFileSync(deploymentFile("sepolia-markets.json"), "utf8"));
  const marketAddr = ethers.getAddress(
    process.env.MARKET_MODULE || prev.contracts.marketLendingModule,
  );
  const inner = ethers.getAddress(
    process.env.INNER_ROUTER ||
      prev.external.swapRouter02 ||
      prev.external.swapRouter02Live,
  );

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("Set PRIVATE_KEY in smart-contracts/.env");

  const market = await ethers.getContractAt("MarketLendingModule", marketAddr, signer);
  const owner = await market.owner();
  const current = await market.swapRouter();

  console.log("Network:", hre.network.name);
  console.log("Signer:", signer.address);
  console.log("Market:", marketAddr);
  console.log("Owner:", owner);
  console.log("Current swapRouter:", current);
  console.log("Inner SwapRouter02:", inner);
  console.log("Dry run:", dry);

  if (dry) return;

  if (hre.network.name === "sepolia" && signer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Signer is not market owner — cannot setSwapRouter");
  }

  const Factory = await ethers.getContractFactory("FeeFallbackSwapRouter", signer);
  const wrap = await Factory.deploy(inner);
  await wrap.waitForDeployment();
  const wrapAddr = await wrap.getAddress();
  console.log("FeeFallbackSwapRouter:", wrapAddr);

  const tx = await market.setSwapRouter(wrapAddr);
  console.log("setSwapRouter tx:", tx.hash);
  await tx.wait();
  console.log("Market swapRouter now:", await market.swapRouter());

  prev.contracts.feeFallbackSwapRouter = wrapAddr;
  prev.external.swapRouter02 = inner;
  fs.writeFileSync(deploymentFile("sepolia-markets.json"), JSON.stringify(prev, null, "\t") + "\n");
  console.log("Updated deployments/sepolia-markets.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
