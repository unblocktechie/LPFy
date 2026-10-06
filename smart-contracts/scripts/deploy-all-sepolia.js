/**
 * Production Sepolia deploy — ALL LPFY contracts from scratch + full wiring.
 *
 * Deploys (new addresses every run):
 *   BorrowRateConfig, ValuationOracle, StaticApySource,
 *   V3Adapter, V4Adapter, MarketLendingModule,
 *   PairVault × 3 (USDC/WETH, USDC/USDT, USDC/WBTC),
 *   CreLiquidationReceiver
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
 *   DEFAULT_APY_BPS=300          # StaticApySource fallback display APY
 *   MAX_PRICE_AGE_SEC=86400      # oracle staleness (default 24h)
 */
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile, creKeeperConfig } = require("../config/paths");
const { SEPOLIA, addr, pairId } = require("./sepolia-addresses");

const DEPLOY = deploymentFile("sepolia-markets.json");

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
  const rates = await BorrowRateConfig.deploy(deployer.address);
  await rates.waitForDeployment();
  const ratesAddr = await rates.getAddress();
  console.log("BorrowRateConfig:", ratesAddr);

  const ValuationOracle = await ethers.getContractFactory("ValuationOracle");
  const oracle = await ValuationOracle.deploy(deployer.address);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("ValuationOracle:", oracleAddr);

  const StaticApySource = await ethers.getContractFactory("StaticApySource");
  const apy = await StaticApySource.deploy(deployer.address, defaultApy);
  await apy.waitForDeployment();
  const apyAddr = await apy.getAddress();
  console.log("StaticApySource:", apyAddr, `(default ${defaultApy} bps)`);

  console.log("\n=== 2) Adapters ===");
  const V3Adapter = await ethers.getContractFactory("V3Adapter");
  const v3 = await V3Adapter.deploy(npm, factory, deployer.address);
  await v3.waitForDeployment();
  const v3Addr = await v3.getAddress();
  console.log("V3Adapter:", v3Addr);

  const V4Adapter = await ethers.getContractFactory("V4Adapter");
  const v4 = await V4Adapter.deploy(v4Npm, v4StateView, deployer.address);
  await v4.waitForDeployment();
  const v4Addr = await v4.getAddress();
  console.log("V4Adapter:", v4Addr);

  console.log("\n=== 3) Market ===");
  const MarketLendingModule = await ethers.getContractFactory("MarketLendingModule");
  const market = await MarketLendingModule.deploy(
    deployer.address,
    debtUsdc,
    oracleAddr,
    ratesAddr,
  );
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("MarketLendingModule:", marketAddr);

  await (await market.setAdapters(v3Addr, v4Addr)).wait();
  await (await market.setApySource(apyAddr)).wait();
  await (await market.setSwapRouter(swapRouter)).wait();

  // Risk params (order: raise LT first if needed, then LTV)
  const curLtv = Number(await market.defaultLtvBps());
  const curLt = Number(await market.defaultLiquidationThresholdBps());
  if (defaultLtv !== curLtv || defaultLt !== curLt) {
    if (defaultLtv <= curLt) {
      await (await market.setDefaultLtvBps(defaultLtv)).wait();
      await (await market.setDefaultLiquidationThresholdBps(defaultLt)).wait();
    } else {
      await (await market.setDefaultLiquidationThresholdBps(defaultLt)).wait();
      await (await market.setDefaultLtvBps(defaultLtv)).wait();
    }
  }
  console.log("LTV/LT:", await market.defaultLtvBps(), "/", await market.defaultLiquidationThresholdBps());

  if (process.env.LIQUIDATION_FEE_BPS !== undefined && process.env.LIQUIDATION_FEE_BPS !== "") {
    const feeBps = Number(process.env.LIQUIDATION_FEE_BPS);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
      throw new Error("LIQUIDATION_FEE_BPS must be 0..10000");
    }
    await (await market.setLiquidationFeeBps(feeBps)).wait();
    console.log("liquidationFeeBps:", feeBps);
  }
  if (process.env.FEE_TO) {
    const feeTo = ethers.getAddress(process.env.FEE_TO);
    await (await market.setFeeTo(feeTo)).wait();
    console.log("feeTo:", feeTo);
  } else {
    console.log("feeTo:", await market.feeTo(), "(deployer)");
  }

  await (await v3.setLendingModule(marketAddr)).wait();
  await (await v4.setLendingModule(marketAddr)).wait();
  await (await v4.setWeth(weth)).wait();
  console.log("Adapters wired to market");

  console.log("\n=== 4) Oracle feeds + adapters ===");
  await (await oracle.setMaxPriceAge(maxPriceAge)).wait();
  await (await oracle.setAdapter(0, v3Addr)).wait();
  await (await oracle.setAdapter(1, v4Addr)).wait();
  await (await oracle.setFeed(weth, ethUsd)).wait();
  await (await oracle.setTokenMaxPriceAge(weth, maxPriceAge)).wait();
  await (await oracle.setFeed(eth, ethUsd)).wait(); // V4 native ETH
  await (await oracle.setTokenMaxPriceAge(eth, maxPriceAge)).wait();
  await (await oracle.setFeed(debtUsdc, usdcUsd)).wait();
  await (await oracle.setTokenMaxPriceAge(debtUsdc, maxPriceAge)).wait();
  await (await oracle.setFeed(usdt, usdcUsd)).wait();
  await (await oracle.setTokenMaxPriceAge(usdt, maxPriceAge)).wait();
  await (await oracle.setFeed(wbtc, btcUsd)).wait();
  await (await oracle.setTokenMaxPriceAge(wbtc, maxPriceAge)).wait();
  console.log("Feeds: WETH, ETH(0), USDC, USDT, WBTC");

  console.log("\n=== 5) Pair rates + display APY ===");
  await (await rates.setPair(debtUsdc, weth, 600, true)).wait();
  await (await rates.setPair(debtUsdc, eth, 600, false)).wait(); // disable native ETH product pair
  await (await rates.setPair(debtUsdc, usdt, 500, true)).wait();
  await (await rates.setPair(debtUsdc, wbtc, 650, true)).wait();

  const pidWeth = pairId(debtUsdc, weth);
  const pidUsdt = pairId(debtUsdc, usdt);
  const pidWbtc = pairId(debtUsdc, wbtc);
  await (await apy.setApyBps(pidWeth, 500)).wait();
  await (await apy.setApyBps(pidUsdt, 400)).wait();
  await (await apy.setApyBps(pidWbtc, 550)).wait();
  console.log("Pairs enabled: USDC/WETH, USDC/USDT, USDC/WBTC");

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
    const vault = await PairVault.deploy(
      debtUsdc,
      marketAddr,
      p.id,
      `LPFY ${p.name}`,
      p.symbol,
    );
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    await (await market.setVault(p.id, vaultAddr)).wait();
    vaults[p.id] = vaultAddr;
    console.log("PairVault", p.name, vaultAddr);
  }

  const seedHuman = process.env.FUND_PER_PAIR || "0";
  const seed = ethers.parseUnits(seedHuman, dec);
  if (seedHuman !== "0" && seed > 0n) {
    const need = seed * BigInt(pairs.length);
    const have = await debt.balanceOf(deployer.address);
    console.log(`${sym} balance:`, ethers.formatUnits(have, dec), "| need", ethers.formatUnits(need, dec));
    if (have >= need) {
      for (const p of pairs) {
        const vaultAddr = vaults[p.id];
        await (await debt.approve(vaultAddr, seed)).wait();
        const vault = await ethers.getContractAt("PairVault", vaultAddr);
        await (await vault.deposit(seed, deployer.address)).wait();
        console.log("Seeded", seedHuman, sym, "→", p.name);
      }
    } else {
      console.warn("Skipping seed — insufficient Circle USDC on deployer");
    }
  } else {
    console.log("Skipping vault seed (FUND_PER_PAIR=0)");
  }

  console.log("\n=== 7) CRE liquidation receiver ===");
  const CreLiquidationReceiver = await ethers.getContractFactory("CreLiquidationReceiver");
  const creReceiver = await CreLiquidationReceiver.deploy(
    deployer.address,
    creForwarder,
    marketAddr,
  );
  await creReceiver.waitForDeployment();
  const creReceiverAddr = await creReceiver.getAddress();
  await (await market.setAuthorizedLiquidator(creReceiverAddr, true)).wait();
  console.log("CreLiquidationReceiver:", creReceiverAddr);

  const out = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    note:
      "Fresh Circle USDC + ERC-4626 PairVaults stack. All LPFY contracts newly deployed.",
    contracts: {
      marketLendingModule: marketAddr,
      borrowRateConfig: ratesAddr,
      staticApySource: apyAddr,
      oracle: oracleAddr,
      v3Adapter: v3Addr,
      v4Adapter: v4Addr,
      creLiquidationReceiver: creReceiverAddr,
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
