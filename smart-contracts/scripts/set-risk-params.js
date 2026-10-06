/**
 * Set live global LTV and/or liquidation threshold on MarketLendingModule.
 * Reads market address from deployments/sepolia-markets.json.
 *
 * Usage (from smart-contracts/):
 *   LTV_BPS=5000 LT_BPS=6500 npx hardhat run scripts/set-risk-params.js --network sepolia
 *
 * Either or both of LTV_BPS / LT_BPS may be set.
 * LT must always remain >= LTV (script orders the calls correctly).
 *
 * Demo (make a near-max loan liquidatable):
 *   LTV_BPS=4000 LT_BPS=4500 npx hardhat run scripts/set-risk-params.js --network sepolia
 */
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile } = require("../config/paths");

const DEPLOY = deploymentFile("sepolia-markets.json");

async function main() {
  const prev = JSON.parse(fs.readFileSync(DEPLOY, "utf8"));
  const marketAddr = ethers.getAddress(
    process.env.MARKET_MODULE || prev.contracts.marketLendingModule,
  );

  const [signer] = await ethers.getSigners();
  const market = await ethers.getContractAt("MarketLendingModule", marketAddr, signer);
  const owner = await market.owner();

  console.log("Market:", marketAddr);
  console.log("Signer:", signer.address);
  console.log("Owner:", owner);
  if (signer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Signer is not market owner");
  }

  const curLtv = Number(await market.defaultLtvBps());
  const curLt = Number(await market.defaultLiquidationThresholdBps());
  console.log(`Current: LTV ${curLtv} bps · LT ${curLt} bps`);

  const hasLtv = process.env.LTV_BPS !== undefined && process.env.LTV_BPS !== "";
  const hasLt = process.env.LT_BPS !== undefined && process.env.LT_BPS !== "";
  if (!hasLtv && !hasLt) {
    throw new Error("Set LTV_BPS and/or LT_BPS (e.g. LTV_BPS=5000 LT_BPS=6500)");
  }

  const newLtv = hasLtv ? Number(process.env.LTV_BPS) : curLtv;
  const newLt = hasLt ? Number(process.env.LT_BPS) : curLt;

  if (!Number.isInteger(newLtv) || newLtv <= 0 || newLtv > 10_000) {
    throw new Error("LTV_BPS must be an integer 1..10000");
  }
  if (!Number.isInteger(newLt) || newLt <= 0 || newLt > 10_000) {
    throw new Error("LT_BPS must be an integer 1..10000");
  }
  if (newLt < newLtv) {
    throw new Error(`LT_BPS (${newLt}) must be >= LTV_BPS (${newLtv})`);
  }

  if (newLtv === curLtv && newLt === curLt) {
    console.log("No change.");
    return;
  }

  console.log(`Setting LTV → ${newLtv}, LT → ${newLt}…`);
  // Cannot set LTV above current LT, or LT below current LTV.
  if (newLtv <= curLt) {
    if (newLtv !== curLtv) {
      const tx = await market.setDefaultLtvBps(newLtv);
      console.log("setDefaultLtvBps tx:", tx.hash);
      await tx.wait();
    }
    if (newLt !== Number(await market.defaultLiquidationThresholdBps())) {
      const tx = await market.setDefaultLiquidationThresholdBps(newLt);
      console.log("setDefaultLiquidationThresholdBps tx:", tx.hash);
      await tx.wait();
    }
  } else {
    if (newLt !== curLt) {
      const tx = await market.setDefaultLiquidationThresholdBps(newLt);
      console.log("setDefaultLiquidationThresholdBps tx:", tx.hash);
      await tx.wait();
    }
    if (newLtv !== Number(await market.defaultLtvBps())) {
      const tx = await market.setDefaultLtvBps(newLtv);
      console.log("setDefaultLtvBps tx:", tx.hash);
      await tx.wait();
    }
  }

  console.log("After:", {
    ltv: Number(await market.defaultLtvBps()),
    lt: Number(await market.defaultLiquidationThresholdBps()),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
