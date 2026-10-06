/**
 * Verify all contracts from deployments/sepolia-markets.json on Etherscan.
 *
 * Usage (from smart-contracts/):
 *   npx hardhat run scripts/verify-sepolia-markets.js --network sepolia
 *
 * Requires ETHERSCAN_API_KEY in smart-contracts/.env
 *
 * Optional:
 *   DEPLOYMENT_FILE=deployments/sepolia-markets.json
 *   SKIP_ALREADY_VERIFIED=1   (default: treat "already verified" as OK)
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function loadDeployment() {
  const rel =
    process.env.DEPLOYMENT_FILE || "deployments/sepolia-markets.json";
  const file = path.isAbsolute(rel) ? rel : path.join(__dirname, "..", rel);
  if (!fs.existsSync(file)) {
    throw new Error(`Deployment file not found: ${file}`);
  }
  return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}

function isAlreadyVerified(err) {
  const msg = `${err?.message || err || ""}`.toLowerCase();
  return (
    msg.includes("already verified") ||
    msg.includes("already been verified") ||
    msg.includes("contract source code already verified")
  );
}

async function verifyOne({ name, address, constructorArguments }) {
  console.log(`\n—— ${name} ——`);
  console.log("  address:", address);
  if (constructorArguments?.length) {
    console.log("  args:", JSON.stringify(constructorArguments));
  }
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments: constructorArguments || [],
    });
    console.log("  ✓ verified");
    return { name, address, status: "verified" };
  } catch (err) {
    if (isAlreadyVerified(err)) {
      console.log("  ✓ already verified");
      return { name, address, status: "already_verified" };
    }
    console.error("  ✗ failed:", err.message || err);
    return { name, address, status: "failed", error: err.message || String(err) };
  }
}

async function main() {
  if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error(
      "Missing ETHERSCAN_API_KEY in smart-contracts/.env (needed for Sepolia verify)"
    );
  }
  if (hre.network.name !== "sepolia") {
    console.warn(
      `Warning: network is "${hre.network.name}" (expected sepolia). Continuing…`
    );
  }

  const { file, data } = loadDeployment();
  const c = data.contracts || {};
  const x = data.external || {};
  const owner = data.deployer;
  if (!owner) throw new Error("deployments JSON missing deployer");

  console.log("Deployment file:", file);
  console.log("Deployer / initialOwner:", owner);

  const targets = [];

  // —— Contracts we can reconstruct from JSON + readable immutables ——

  if (c.borrowRateConfig) {
    targets.push({
      name: "BorrowRateConfig",
      address: c.borrowRateConfig,
      constructorArguments: [owner],
    });
  }

  if (c.oracle) {
    targets.push({
      name: "ValuationOracle",
      address: c.oracle,
      constructorArguments: [owner],
    });
  }

  if (c.staticApySource) {
    const apy = await hre.ethers.getContractAt(
      "StaticApySource",
      c.staticApySource
    );
    const defaultApyBps = Number(await apy.defaultApyBps());
    targets.push({
      name: "StaticApySource",
      address: c.staticApySource,
      constructorArguments: [owner, defaultApyBps],
    });
  }

  if (c.v3Adapter && x.uniswapV3Npm && x.factory) {
    targets.push({
      name: "V3Adapter",
      address: c.v3Adapter,
      constructorArguments: [x.uniswapV3Npm, x.factory, owner],
    });
  }

  if (c.v4Adapter && x.v4Npm && x.v4StateView) {
    targets.push({
      name: "V4Adapter",
      address: c.v4Adapter,
      constructorArguments: [x.v4Npm, x.v4StateView, owner],
    });
  }

  if (c.marketLendingModule && c.debtAsset && c.oracle && c.borrowRateConfig) {
    targets.push({
      name: "MarketLendingModule",
      address: c.marketLendingModule,
      constructorArguments: [
        owner,
        c.debtAsset,
        c.oracle,
        c.borrowRateConfig,
      ],
    });
  }

  // PairVaults — read name/symbol/asset/market/pairId on-chain
  const vaultEntries = Object.entries(c.pairVaults || {});
  for (const [pairId, vaultAddr] of vaultEntries) {
    const vault = await hre.ethers.getContractAt("PairVault", vaultAddr);
    const [asset, market, onchainPairId, name, symbol] = await Promise.all([
      vault.asset(),
      vault.market(),
      vault.pairId(),
      vault.name(),
      vault.symbol(),
    ]);
    if (onchainPairId.toLowerCase() !== pairId.toLowerCase()) {
      console.warn(
        `PairVault ${vaultAddr}: JSON pairId ${pairId} != on-chain ${onchainPairId}`
      );
    }
    targets.push({
      name: `PairVault ${symbol}`,
      address: vaultAddr,
      constructorArguments: [asset, market, onchainPairId, name, symbol],
    });
  }

  if (c.creLiquidationReceiver && c.marketLendingModule) {
    const rx = await hre.ethers.getContractAt(
      "CreLiquidationReceiver",
      c.creLiquidationReceiver
    );
    const forwarder = await rx.forwarder();
    const market = await rx.market();
    targets.push({
      name: "CreLiquidationReceiver",
      address: c.creLiquidationReceiver,
      constructorArguments: [owner, forwarder, market],
    });
  }

  console.log(`\nVerifying ${targets.length} contract(s)…`);

  const results = [];
  for (const t of targets) {
    // Small delay to reduce Etherscan rate-limit flakes
    await new Promise((r) => setTimeout(r, 1500));
    results.push(await verifyOne(t));
  }

  const ok = results.filter(
    (r) => r.status === "verified" || r.status === "already_verified"
  );
  const failed = results.filter((r) => r.status === "failed");

  console.log("\n========== SUMMARY ==========");
  console.log(`OK: ${ok.length}/${results.length}`);
  for (const r of ok) {
    console.log(`  ✓ ${r.name} (${r.status})`);
  }
  if (failed.length) {
    console.log(`Failed: ${failed.length}`);
    for (const r of failed) {
      console.log(`  ✗ ${r.name}: ${r.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
