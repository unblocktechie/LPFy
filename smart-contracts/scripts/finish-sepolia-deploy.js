/**
 * Finish a partially completed deploy-all-sepolia run:
 * seed PairVaults, deploy CreLiquidationReceiver, write deployments JSON, sync CRE/web.
 *
 * Fill ADDRESSES from the failed deploy log, then:
 *   FUND_PER_PAIR=5 FEE_TO=0x... npx hardhat run scripts/finish-sepolia-deploy.js --network sepolia
 */
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile, creKeeperConfig } = require("../config/paths");
const { SEPOLIA, addr, pairId } = require("./sepolia-addresses");

const DEPLOY = deploymentFile("sepolia-markets.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTx(sendFn, label = "tx") {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const tx = await sendFn();
      const receipt = await tx.wait();
      await sleep(2000);
      return receipt;
    } catch (e) {
      const msg = String(e?.shortMessage || e?.message || e);
      if (
        !/in-flight|too many|429|rate|TIMEOUT|timeout|nonce/i.test(msg) ||
        attempt === 8
      ) {
        throw e;
      }
      console.warn(`Retry ${attempt}/8 ${label}: ${msg.slice(0, 140)}`);
      await sleep(5000 * attempt);
    }
  }
}

async function deploy(factory, args, label) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const c = await factory.deploy(...args);
      await c.waitForDeployment();
      await sleep(3000);
      return c;
    } catch (e) {
      const msg = String(e?.shortMessage || e?.message || e);
      if (
        !/in-flight|too many|429|rate|TIMEOUT|timeout|nonce/i.test(msg) ||
        attempt === 8
      ) {
        throw e;
      }
      console.warn(`Retry ${attempt}/8 deploy ${label}: ${msg.slice(0, 140)}`);
      await sleep(5000 * attempt);
    }
  }
}

// From the partial deploy log (2026-11-02)
const ADDRESSES = {
  marketLendingModule: "0x2aA65f005C1eDd8C91578D8e2aC7866206adb576",
  borrowRateConfig: "0x86d5A6718380b3bbe9ad06b33495Fb4Fb88f1A9f",
  staticApySource: "0xF411478381B132C48EaC073b6A14B4f10365F048",
  oracle: "0x3D50dBd492Bad456eCF6E877b4bf4a2479A96A8d",
  v3Adapter: "0x8251ccb1ba6d434e1848ECF8790250159Ecd130E",
  v4Adapter: "0xf50aF8Fa2cEa204756Ce3C51B4654E7b42C2dbDA",
  feeFallbackSwapRouter: "0x9dA6cd89554c2B2B19147184D96C10267E65fC1D",
  vaultUsdcWeth: "0xF8651A455f00eF36223f90eb5f9aBA8D590b12Ec",
  vaultUsdcUsdt: "0x616C1B34e504C7625733499a7216D76A172EAB32",
  vaultUsdcWbtc: "0x618D3A60fdB5b09D1cCe8B6EDd30654AcE431ba6",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const debtUsdc = addr("circleUsdc");
  const weth = addr("weth");
  const usdt = addr("usdt");
  const wbtc = addr("wbtc");
  const creForwarder = addr("creForwarder");
  const swapRouter = addr("swapRouter02");

  const pidWeth = pairId(debtUsdc, weth);
  const pidUsdt = pairId(debtUsdc, usdt);
  const pidWbtc = pairId(debtUsdc, wbtc);

  const market = await ethers.getContractAt(
    "MarketLendingModule",
    ADDRESSES.marketLendingModule,
  );
  const vaults = {
    [pidWeth]: ADDRESSES.vaultUsdcWeth,
    [pidUsdt]: ADDRESSES.vaultUsdcUsdt,
    [pidWbtc]: ADDRESSES.vaultUsdcWbtc,
  };

  console.log("Market:", ADDRESSES.marketLendingModule);
  console.log("Finishing seed + CRE + JSON…");

  const debt = await ethers.getContractAt(
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
    ],
    debtUsdc,
  );
  const dec = Number(await debt.decimals());
  const sym = await debt.symbol();
  const seedHuman = process.env.FUND_PER_PAIR || "5";
  const seed = ethers.parseUnits(seedHuman, dec);

  for (const [name, vaultAddr] of [
    ["USDC/WETH", ADDRESSES.vaultUsdcWeth],
    ["USDC/USDT", ADDRESSES.vaultUsdcUsdt],
    ["USDC/WBTC", ADDRESSES.vaultUsdcWbtc],
  ]) {
    const vault = await ethers.getContractAt("PairVault", vaultAddr);
    const shares = await vault.balanceOf(deployer.address);
    if (shares > 0n) {
      console.log("Already seeded", name, "shares", shares.toString());
      continue;
    }
    const allow = await debt.allowance(deployer.address, vaultAddr);
    if (allow < seed) {
      await waitTx(() => debt.approve(vaultAddr, seed), `approve ${name}`);
    }
    await waitTx(() => vault.deposit(seed, deployer.address), `deposit ${name}`);
    console.log("Seeded", seedHuman, sym, "→", name);
  }

  console.log("\n=== CRE liquidation receiver ===");
  const CreLiquidationReceiver = await ethers.getContractFactory(
    "CreLiquidationReceiver",
  );
  const creReceiver = await deploy(
    CreLiquidationReceiver,
    [deployer.address, creForwarder, ADDRESSES.marketLendingModule],
    "CreLiquidationReceiver",
  );
  const creReceiverAddr = await creReceiver.getAddress();
  await waitTx(
    () => market.setAuthorizedLiquidator(creReceiverAddr, true),
    "authorize CRE",
  );
  console.log("CreLiquidationReceiver:", creReceiverAddr);

  const pairs = [
    { name: "USDC/WETH", id: pidWeth, aprBps: 600, lenderApyBps: 500 },
    { name: "USDC/USDT", id: pidUsdt, aprBps: 500, lenderApyBps: 400 },
    { name: "USDC/WBTC", id: pidWbtc, aprBps: 650, lenderApyBps: 550 },
  ];

  const out = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    note:
      "Fresh Circle USDC + ERC-4626 PairVaults + per-pair LTV/LT. Finished via finish-sepolia-deploy.js.",
    contracts: {
      marketLendingModule: ADDRESSES.marketLendingModule,
      borrowRateConfig: ADDRESSES.borrowRateConfig,
      staticApySource: ADDRESSES.staticApySource,
      oracle: ADDRESSES.oracle,
      v3Adapter: ADDRESSES.v3Adapter,
      v4Adapter: ADDRESSES.v4Adapter,
      creLiquidationReceiver: creReceiverAddr,
      feeFallbackSwapRouter: ADDRESSES.feeFallbackSwapRouter,
      debtAsset: debtUsdc,
      debtAssetDecimals: dec,
      debtAssetSymbol: sym,
      pairVaults: vaults,
    },
    external: {
      uniswapV3Npm: addr("uniswapV3Npm"),
      factory: addr("factory"),
      weth,
      circleUsdc: debtUsdc,
      usdt,
      wbtc,
      ethUsd: addr("ethUsd"),
      usdcUsd: addr("usdcUsd"),
      btcUsd: addr("btcUsd"),
      v4Npm: addr("v4Npm"),
      v4StateView: addr("v4StateView"),
      swapRouter02: swapRouter,
      swapRouter02Live: swapRouter,
      creForwarder,
    },
    risk: {
      defaultLtvBps: Number(await market.defaultLtvBps()),
      defaultLiquidationThresholdBps: Number(
        await market.defaultLiquidationThresholdBps(),
      ),
      liquidationFeeBps: Number(await market.liquidationFeeBps()),
      feeTo: await market.feeTo(),
      pairs: Object.fromEntries(
        await Promise.all(
          pairs.map(async (p) => [
            p.name,
            {
              pairId: p.id,
              ltvBps: Number(await market.ltvBpsOf(p.id)),
              liquidationThresholdBps: Number(
                await market.liquidationThresholdBpsOf(p.id),
              ),
            },
          ]),
        ),
      ),
    },
    pairsEnabled: pairs.map((p) => ({
      a: "USDC",
      b: p.name.split("/")[1],
      aprBps: p.aprBps,
      lenderApyBps: p.lenderApyBps,
      pairId: p.id,
      vault: vaults[p.id],
    })),
    webEnv: {
      VITE_NETWORK: "sepolia",
      VITE_SEPOLIA_MARKET_MODULE: ADDRESSES.marketLendingModule,
      VITE_SEPOLIA_ORACLE: ADDRESSES.oracle,
      VITE_SEPOLIA_V3_ADAPTER: ADDRESSES.v3Adapter,
      VITE_SEPOLIA_V4_ADAPTER: ADDRESSES.v4Adapter,
      VITE_SEPOLIA_USDC: debtUsdc,
      VITE_SEPOLIA_BORROW_RATES: ADDRESSES.borrowRateConfig,
      VITE_SEPOLIA_APY_SOURCE: ADDRESSES.staticApySource,
      VITE_SEPOLIA_USDT: usdt,
      VITE_SEPOLIA_WBTC: wbtc,
      VITE_SEPOLIA_CRE_RECEIVER: creReceiverAddr,
      VITE_SEPOLIA_VAULT_USDC_WETH: ADDRESSES.vaultUsdcWeth,
      VITE_SEPOLIA_VAULT_USDC_USDT: ADDRESSES.vaultUsdcUsdt,
      VITE_SEPOLIA_VAULT_USDC_WBTC: ADDRESSES.vaultUsdcWbtc,
    },
  };

  fs.writeFileSync(DEPLOY, JSON.stringify(out, null, 2) + "\n");
  console.log("Saved", DEPLOY);

  for (const file of ["config.staging.json", "config.production.json"]) {
    const cfgPath = creKeeperConfig(file);
    const cfg = fs.existsSync(cfgPath)
      ? JSON.parse(fs.readFileSync(cfgPath, "utf8"))
      : {
          schedule: "0 */5 * * * *",
          evms: [{ chainSelectorName: "ethereum-testnet-sepolia" }],
        };
    if (!cfg.evms || !cfg.evms[0]) {
      cfg.evms = [{ chainSelectorName: "ethereum-testnet-sepolia" }];
    }
    cfg.evms[0].contractAddress = creReceiverAddr;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    console.log("Updated CRE", file, "→", creReceiverAddr);
  }

  try {
    require("./sync-addresses").main();
  } catch (e) {
    console.warn("sync-addresses skipped:", e.message || e);
  }

  console.log("\n========== FINISH COMPLETE ==========");
  console.log("Market:", ADDRESSES.marketLendingModule);
  console.log("CRE receiver:", creReceiverAddr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
