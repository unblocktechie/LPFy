/**
 * Production Sepolia deploy — ALL LPFY contracts from scratch + full wiring.
 *
 * Deploys (new addresses every run):
 *   BorrowRateConfig, ValuationOracle, StaticApySource,
 *   V3Adapter, V4Adapter, MarketLendingModule,
 *   PairVault × 3 (USDC/WETH, USDC/USDT, USDC/WBTC),
 *   CreLiquidationReceiver, FeeFallbackSwapRouter
 *
 * Does NOT deploy (already on Sepolia): Circle USDC, WETH, Uniswap, Chainlink feeds, CRE Forwarder.
 *
 * Usage (from smart-contracts/):
 *   npx hardhat run scripts/deploy-all-sepolia.js --network sepolia
 *   npm run deploy:sepolia
 *
 * Optional env:
 *   FUND_PER_PAIR=100            # Circle USDC seeded into each PairVault (0 = skip)
 *   LIQUIDATION_FEE_BPS=1000     # surplus fee to feeTo (1000 = 10%)
 *   FEE_TO=0x...                 # fee recipient (default = deployer)
 *   DEFAULT_LTV_BPS=5000         # default 50%
 *   DEFAULT_LT_BPS=6500          # default 65% (must be >= LTV)
 *   LTV_BPS_USDC_WETH / LT_BPS_USDC_WETH (and USDT / WBTC) for per-pair overrides
 *   DEFAULT_APY_BPS=300          # StaticApySource fallback display APY
 *   MAX_PRICE_AGE_SEC=86400      # oracle staleness (default 24h)
 */
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile, creKeeperConfig } = require("../config/paths");
const { SEPOLIA, addr, pairId } = require("./sepolia-addresses");

const DEPLOY = deploymentFile("sepolia-markets.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deploy with retries — public Sepolia RPCs often hit in-flight tx limits. */
async function deploy(factory, args = [], label = "contract") {
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
      await sleep(4000 * attempt);
    }
  }
  throw new Error(`deploy failed: ${label}`);
}

/** @param {() => Promise<any> | Promise<any>} sendFnOrPromise */
async function waitTx(sendFnOrPromise, label = "tx") {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const tx =
        typeof sendFnOrPromise === "function"
          ? await sendFnOrPromise()
          : await sendFnOrPromise;
      const receipt = await tx.wait();
      await sleep(1500);
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
      await sleep(4000 * attempt);
    }
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Set PRIVATE_KEY in smart-contracts/.env");

  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  if (bal === 0n) throw new Error("Deployer has 0 Sepolia ETH");

  const debtUsdc = addr("circleUsdc");
  const weth = addr("weth");
  const usdt = addr("usdt");
  const wbtc = addr("wbtc");
  const npm = addr("uniswapV3Npm");
  const factory = addr("factory");
  const swapRouter = addr("swapRouter02");
  const v4Npm = addr("v4Npm");
  const v4StateView = addr("v4StateView");
  const ethUsd = addr("ethUsd");
  const usdcUsd = addr("usdcUsd");
  const btcUsd = addr("btcUsd");
  const creForwarder = addr("creForwarder");
  const eth = ethers.ZeroAddress;

  const defaultLtv = Number(process.env.DEFAULT_LTV_BPS || "5000");
  const defaultLt = Number(process.env.DEFAULT_LT_BPS || "6500");
  const defaultApy = Number(process.env.DEFAULT_APY_BPS || "300");
  const maxPriceAge = Number(process.env.MAX_PRICE_AGE_SEC || String(24 * 60 * 60));

  if (!(defaultLtv > 0 && defaultLtv <= 10_000)) throw new Error("bad DEFAULT_LTV_BPS");
  if (!(defaultLt > 0 && defaultLt <= 10_000)) throw new Error("bad DEFAULT_LT_BPS");
  if (defaultLt < defaultLtv) throw new Error("DEFAULT_LT_BPS must be >= DEFAULT_LTV_BPS");
  if (!(defaultApy >= 0 && defaultApy <= 10_000)) throw new Error("bad DEFAULT_APY_BPS");

  console.log("\n=== 1) Core config contracts ===");
  const BorrowRateConfig = await ethers.getContractFactory("BorrowRateConfig");
  const rates = await deploy(BorrowRateConfig, [deployer.address], "BorrowRateConfig");
  const ratesAddr = await rates.getAddress();
  console.log("BorrowRateConfig:", ratesAddr);

  const ValuationOracle = await ethers.getContractFactory("ValuationOracle");
  const oracle = await deploy(ValuationOracle, [deployer.address], "ValuationOracle");
  const oracleAddr = await oracle.getAddress();
  console.log("ValuationOracle:", oracleAddr);

  const StaticApySource = await ethers.getContractFactory("StaticApySource");
  const apy = await deploy(
    StaticApySource,
    [deployer.address, defaultApy],
    "StaticApySource",
  );
  const apyAddr = await apy.getAddress();
  console.log("StaticApySource:", apyAddr, `(default ${defaultApy} bps)`);

  console.log("\n=== 2) Adapters ===");
  const V3Adapter = await ethers.getContractFactory("V3Adapter");
  const v3 = await deploy(V3Adapter, [npm, factory, deployer.address], "V3Adapter");
  const v3Addr = await v3.getAddress();
  console.log("V3Adapter:", v3Addr);

  const V4Adapter = await ethers.getContractFactory("V4Adapter");
  const v4 = await deploy(
    V4Adapter,
    [v4Npm, v4StateView, deployer.address],
    "V4Adapter",
  );
  const v4Addr = await v4.getAddress();
  console.log("V4Adapter:", v4Addr);

  console.log("\n=== 3) Market ===");
  const MarketLendingModule = await ethers.getContractFactory("MarketLendingModule");
  const market = await deploy(
    MarketLendingModule,
    [deployer.address, debtUsdc, oracleAddr, ratesAddr],
    "MarketLendingModule",
  );
  const marketAddr = await market.getAddress();
  console.log("MarketLendingModule:", marketAddr);

  await waitTx(() => market.setAdapters(v3Addr, v4Addr), "setAdapters");
  await waitTx(() => market.setApySource(apyAddr), "setApySource");

  const FeeFallbackSwapRouter = await ethers.getContractFactory("FeeFallbackSwapRouter");
  const feeRouter = await deploy(
    FeeFallbackSwapRouter,
    [swapRouter],
    "FeeFallbackSwapRouter",
  );
  const feeRouterAddr = await feeRouter.getAddress();
  await waitTx(() => market.setSwapRouter(feeRouterAddr), "setSwapRouter");
  console.log("FeeFallbackSwapRouter:", feeRouterAddr);

  const curLtv = Number(await market.defaultLtvBps());
  const curLt = Number(await market.defaultLiquidationThresholdBps());
  if (defaultLtv !== curLtv || defaultLt !== curLt) {
    if (defaultLtv <= curLt) {
      await waitTx(() => market.setDefaultLtvBps(defaultLtv), "setDefaultLtvBps");
      await waitTx(
        () => market.setDefaultLiquidationThresholdBps(defaultLt),
        "setDefaultLT",
      );
    } else {
      await waitTx(
        () => market.setDefaultLiquidationThresholdBps(defaultLt),
        "setDefaultLT",
      );
      await waitTx(() => market.setDefaultLtvBps(defaultLtv), "setDefaultLtvBps");
    }
  }
  console.log(
    "Default LTV/LT:",
    await market.defaultLtvBps(),
    "/",
    await market.defaultLiquidationThresholdBps(),
  );

  if (process.env.LIQUIDATION_FEE_BPS !== undefined && process.env.LIQUIDATION_FEE_BPS !== "") {
    const feeBps = Number(process.env.LIQUIDATION_FEE_BPS);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
      throw new Error("LIQUIDATION_FEE_BPS must be 0..10000");
    }
    await waitTx(() => market.setLiquidationFeeBps(feeBps), "setLiquidationFeeBps");
    console.log("liquidationFeeBps:", feeBps);
  }
  if (process.env.FEE_TO) {
    const feeTo = ethers.getAddress(process.env.FEE_TO);
    await waitTx(() => market.setFeeTo(feeTo), "setFeeTo");
    console.log("feeTo:", feeTo);
  } else {
    console.log("feeTo:", await market.feeTo(), "(deployer)");
  }

  await waitTx(() => v3.setLendingModule(marketAddr), "v3.setLendingModule");
  await waitTx(() => v4.setLendingModule(marketAddr), "v4.setLendingModule");
  await waitTx(() => v4.setWeth(weth), "v4.setWeth");
  console.log("Adapters wired to market");

  console.log("\n=== 4) Oracle feeds + adapters ===");
  await waitTx(() => oracle.setMaxPriceAge(maxPriceAge), "setMaxPriceAge");
  await waitTx(() => oracle.setAdapter(0, v3Addr), "setAdapter v3");
  await waitTx(() => oracle.setAdapter(1, v4Addr), "setAdapter v4");
  await waitTx(() => oracle.setFeed(weth, ethUsd), "feed weth");
  await waitTx(() => oracle.setTokenMaxPriceAge(weth, maxPriceAge), "age weth");
  await waitTx(() => oracle.setFeed(eth, ethUsd), "feed eth");
  await waitTx(() => oracle.setTokenMaxPriceAge(eth, maxPriceAge), "age eth");
  await waitTx(() => oracle.setFeed(debtUsdc, usdcUsd), "feed usdc");
  await waitTx(() => oracle.setTokenMaxPriceAge(debtUsdc, maxPriceAge), "age usdc");
  await waitTx(() => oracle.setFeed(usdt, usdcUsd), "feed usdt");
  await waitTx(() => oracle.setTokenMaxPriceAge(usdt, maxPriceAge), "age usdt");
  await waitTx(() => oracle.setFeed(wbtc, btcUsd), "feed wbtc");
  await waitTx(() => oracle.setTokenMaxPriceAge(wbtc, maxPriceAge), "age wbtc");
  console.log("Feeds: WETH, ETH(0), USDC, USDT, WBTC");

  console.log("\n=== 5) Pair rates + display APY ===");
  await waitTx(() => rates.setPair(debtUsdc, weth, 600, true), "rates usdc/weth");
  await waitTx(() => rates.setPair(debtUsdc, eth, 600, false), "rates usdc/eth off");
  await waitTx(() => rates.setPair(debtUsdc, usdt, 500, true), "rates usdc/usdt");
  await waitTx(() => rates.setPair(debtUsdc, wbtc, 650, true), "rates usdc/wbtc");

  const pidWeth = pairId(debtUsdc, weth);
  const pidUsdt = pairId(debtUsdc, usdt);
  const pidWbtc = pairId(debtUsdc, wbtc);
  await waitTx(() => apy.setApyBps(pidWeth, 500), "apy weth");
  await waitTx(() => apy.setApyBps(pidUsdt, 400), "apy usdt");
  await waitTx(() => apy.setApyBps(pidWbtc, 550), "apy wbtc");
  console.log("Pairs enabled: USDC/WETH, USDC/USDT, USDC/WBTC");

  const pairRisk = [
    {
      id: pidWeth,
      name: "USDC/WETH",
      ltv: Number(process.env.LTV_BPS_USDC_WETH || defaultLtv),
      lt: Number(process.env.LT_BPS_USDC_WETH || defaultLt),
    },
    {
      id: pidUsdt,
      name: "USDC/USDT",
      ltv: Number(process.env.LTV_BPS_USDC_USDT || defaultLtv),
      lt: Number(process.env.LT_BPS_USDC_USDT || defaultLt),
    },
    {
      id: pidWbtc,
      name: "USDC/WBTC",
      ltv: Number(process.env.LTV_BPS_USDC_WBTC || defaultLtv),
      lt: Number(process.env.LT_BPS_USDC_WBTC || defaultLt),
    },
  ];
  for (const r of pairRisk) {
    if (!(r.ltv > 0 && r.ltv <= 10_000) || !(r.lt > 0 && r.lt <= 10_000) || r.lt < r.ltv) {
      throw new Error(`bad pair risk for ${r.name}: LTV=${r.ltv} LT=${r.lt}`);
    }
    await waitTx(
      () => market.setPairRiskParams(r.id, r.ltv, r.lt),
      `pairRisk ${r.name}`,
    );
    console.log(`Pair risk ${r.name}: LTV ${r.ltv} / LT ${r.lt}`);
  }

  console.log("\n=== 6) PairVaults (ERC-4626) ===");
  const debt = await ethers.getContractAt(
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
    ],
    debtUsdc,
  );
  const dec = Number(await debt.decimals());
  const sym = await debt.symbol();

  const pairs = [
    { name: "USDC/WETH", id: pidWeth, symbol: "lvUSDC-WETH", aprBps: 600, lenderApyBps: 500 },
    { name: "USDC/USDT", id: pidUsdt, symbol: "lvUSDC-USDT", aprBps: 500, lenderApyBps: 400 },
    { name: "USDC/WBTC", id: pidWbtc, symbol: "lvUSDC-WBTC", aprBps: 650, lenderApyBps: 550 },
  ];

  const PairVault = await ethers.getContractFactory("PairVault");
  const vaults = {};
  for (const p of pairs) {
    const vault = await deploy(
      PairVault,
      [debtUsdc, marketAddr, p.id, `LPFY ${p.name}`, p.symbol],
      `PairVault ${p.name}`,
    );
    const vaultAddr = await vault.getAddress();
    await waitTx(() => market.setVault(p.id, vaultAddr), `setVault ${p.name}`);
    vaults[p.id] = vaultAddr;
    console.log("PairVault", p.name, vaultAddr);
  }

  const seedHuman = process.env.FUND_PER_PAIR || "0";
  const seed = ethers.parseUnits(seedHuman, dec);
  if (seedHuman !== "0" && seed > 0n) {
    const need = seed * BigInt(pairs.length);
    const have = await debt.balanceOf(deployer.address);
    console.log(
      `${sym} balance:`,
      ethers.formatUnits(have, dec),
      "| need",
      ethers.formatUnits(need, dec),
    );
    if (have >= need) {
      for (const p of pairs) {
        const vaultAddr = vaults[p.id];
        await waitTx(() => debt.approve(vaultAddr, seed), `approve ${p.name}`);
        const vault = await ethers.getContractAt("PairVault", vaultAddr);
        await waitTx(
          () => vault.deposit(seed, deployer.address),
          `deposit ${p.name}`,
        );
        console.log("Seeded", seedHuman, sym, "→", p.name);
      }
    } else {
      console.warn("Skipping seed — insufficient Circle USDC on deployer");
    }
  } else {
    console.log("Skipping vault seed (FUND_PER_PAIR=0)");
  }

  console.log("\n=== 7) CRE liquidation receiver ===");
  const CreLiquidationReceiver = await ethers.getContractFactory(
    "CreLiquidationReceiver",
  );
  const creReceiver = await deploy(
    CreLiquidationReceiver,
    [deployer.address, creForwarder, marketAddr],
    "CreLiquidationReceiver",
  );
  const creReceiverAddr = await creReceiver.getAddress();
  await waitTx(
    () => market.setAuthorizedLiquidator(creReceiverAddr, true),
    "authorize CRE receiver",
  );
  console.log("CreLiquidationReceiver:", creReceiverAddr);

  const out = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    note:
      "Fresh Circle USDC + ERC-4626 PairVaults + per-pair LTV/LT. All LPFY contracts newly deployed.",
    contracts: {
      marketLendingModule: marketAddr,
      borrowRateConfig: ratesAddr,
      staticApySource: apyAddr,
      oracle: oracleAddr,
      v3Adapter: v3Addr,
      v4Adapter: v4Addr,
      creLiquidationReceiver: creReceiverAddr,
      feeFallbackSwapRouter: feeRouterAddr,
      debtAsset: debtUsdc,
      debtAssetDecimals: dec,
      debtAssetSymbol: sym,
      pairVaults: vaults,
    },
    external: {
      uniswapV3Npm: npm,
      factory,
      weth,
      circleUsdc: debtUsdc,
      usdt,
      wbtc,
      ethUsd,
      usdcUsd,
      btcUsd,
      v4Npm,
      v4StateView,
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
          pairRisk.map(async (r) => [
            r.name,
            {
              pairId: r.id,
              ltvBps: Number(await market.ltvBpsOf(r.id)),
              liquidationThresholdBps: Number(
                await market.liquidationThresholdBpsOf(r.id),
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
      VITE_SEPOLIA_MARKET_MODULE: marketAddr,
      VITE_SEPOLIA_ORACLE: oracleAddr,
      VITE_SEPOLIA_V3_ADAPTER: v3Addr,
      VITE_SEPOLIA_V4_ADAPTER: v4Addr,
      VITE_SEPOLIA_USDC: debtUsdc,
      VITE_SEPOLIA_BORROW_RATES: ratesAddr,
      VITE_SEPOLIA_APY_SOURCE: apyAddr,
      VITE_SEPOLIA_USDT: usdt,
      VITE_SEPOLIA_WBTC: wbtc,
      VITE_SEPOLIA_CRE_RECEIVER: creReceiverAddr,
      VITE_SEPOLIA_VAULT_USDC_WETH: vaults[pidWeth],
      VITE_SEPOLIA_VAULT_USDC_USDT: vaults[pidUsdt],
      VITE_SEPOLIA_VAULT_USDC_WBTC: vaults[pidWbtc],
    },
  };

  fs.mkdirSync(require("path").dirname(DEPLOY), { recursive: true });
  fs.writeFileSync(DEPLOY, JSON.stringify(out, null, 2) + "\n");
  console.log("\nSaved", DEPLOY);

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

  console.log("\n========== DEPLOY COMPLETE ==========");
  console.log("Market:", marketAddr);
  console.log("Oracle:", oracleAddr);
  console.log("CRE receiver:", creReceiverAddr);
  console.log("Debt:", sym, debtUsdc);
  console.log("Next:");
  console.log("  1) npm run verify:sepolia");
  console.log("  2) npm run sync:addresses   # web/.env + README examples");
  console.log("  3) Restart Vite");

  try {
    require("./sync-addresses").main();
  } catch (e) {
    console.warn("sync-addresses skipped:", e.message || e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
