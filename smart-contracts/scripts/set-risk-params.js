/**
 * Set LTV and/or liquidation threshold on MarketLendingModule.
 * Reads market address from deployments/sepolia-markets.json.
 *
 * Global defaults (fallback when a pair has no override):
 *   LTV_BPS=5000 LT_BPS=6500 npx hardhat run scripts/set-risk-params.js --network sepolia
 *
 * Per-pair (TOKEN_A + TOKEN_B or PAIR_ID):
 *   TOKEN_A=0xUSDC TOKEN_B=0xWETH LTV_BPS=4500 LT_BPS=6000 \
 *     npx hardhat run scripts/set-risk-params.js --network sepolia
 *
 * Clear pair override (back to global defaults):
 *   TOKEN_A=0xUSDC TOKEN_B=0xWETH CLEAR_PAIR=1 \
 *     npx hardhat run scripts/set-risk-params.js --network sepolia
 */
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile } = require("../config/paths");
const { pairId: pairIdOf } = require("./sepolia-addresses");

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

  let pairId;
  if (process.env.PAIR_ID) {
    pairId = process.env.PAIR_ID;
    if (!/^0x[a-fA-F0-9]{64}$/.test(pairId)) throw new Error("PAIR_ID must be bytes32");
  } else if (process.env.TOKEN_A && process.env.TOKEN_B) {
    pairId = pairIdOf(
      ethers.getAddress(process.env.TOKEN_A),
      ethers.getAddress(process.env.TOKEN_B),
    );
  }

  if (pairId) {
    console.log("Pair:", pairId);
    console.log(
      `Current effective: LTV ${await market.ltvBpsOf(pairId)} · LT ${await market.liquidationThresholdBpsOf(pairId)}`,
    );
    console.log(
      `Overrides: LTV ${await market.pairLtvBps(pairId)} · LT ${await market.pairLiquidationThresholdBps(pairId)} (0 = default)`,
    );

    if (process.env.CLEAR_PAIR === "1") {
      const tx = await market.clearPairRiskParams(pairId);
      console.log("clearPairRiskParams tx:", tx.hash);
      await tx.wait();
      console.log("After effective:", {
        ltv: Number(await market.ltvBpsOf(pairId)),
        lt: Number(await market.liquidationThresholdBpsOf(pairId)),
      });
      return;
    }

    const hasLtv = process.env.LTV_BPS !== undefined && process.env.LTV_BPS !== "";
    const hasLt = process.env.LT_BPS !== undefined && process.env.LT_BPS !== "";
    if (!hasLtv || !hasLt) {
      throw new Error("Per-pair set requires both LTV_BPS and LT_BPS (or CLEAR_PAIR=1)");
    }
    const newLtv = Number(process.env.LTV_BPS);
    const newLt = Number(process.env.LT_BPS);
    if (!Number.isInteger(newLtv) || newLtv <= 0 || newLtv > 10_000) {
      throw new Error("LTV_BPS must be an integer 1..10000");
    }
    if (!Number.isInteger(newLt) || newLt <= 0 || newLt > 10_000) {
      throw new Error("LT_BPS must be an integer 1..10000");
    }
    if (newLt < newLtv) {
      throw new Error(`LT_BPS (${newLt}) must be >= LTV_BPS (${newLtv})`);
    }

    const tx = await market.setPairRiskParams(pairId, newLtv, newLt);
    console.log("setPairRiskParams tx:", tx.hash);
    await tx.wait();
    console.log("After effective:", {
      ltv: Number(await market.ltvBpsOf(pairId)),
      lt: Number(await market.liquidationThresholdBpsOf(pairId)),
    });
    return;
  }

  // Global defaults
  const curLtv = Number(await market.defaultLtvBps());
  const curLt = Number(await market.defaultLiquidationThresholdBps());
  console.log(`Current defaults: LTV ${curLtv} bps · LT ${curLt} bps`);

  const hasLtv = process.env.LTV_BPS !== undefined && process.env.LTV_BPS !== "";
  const hasLt = process.env.LT_BPS !== undefined && process.env.LT_BPS !== "";
  if (!hasLtv && !hasLt) {
    throw new Error(
      "Set LTV_BPS and/or LT_BPS (global), or TOKEN_A+TOKEN_B / PAIR_ID for per-pair",
    );
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

  console.log(`Setting defaults LTV → ${newLtv}, LT → ${newLt}…`);
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

  console.log("After defaults:", {
    ltv: Number(await market.defaultLtvBps()),
    lt: Number(await market.defaultLiquidationThresholdBps()),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
