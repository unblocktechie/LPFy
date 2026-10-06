/**
 * Redeploy market + adapters + PairVaults + CRE receiver.
 * Reuses ValuationOracle, BorrowRateConfig, StaticApySource from deployments JSON.
 *
 * Prefer scripts/deploy-all-sepolia.js for a full from-scratch deploy (hackathon).
 *
 *   npx hardhat run scripts/redeploy-market-per-pair-sepolia.js --network sepolia
 *
 * Optional: FUND_PER_PAIR, LIQUIDATION_FEE_BPS, FEE_TO
 */
const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { deploymentFile, creKeeperConfig } = require("../config/paths");
const { SEPOLIA, addr, pairId } = require("./sepolia-addresses");

const DEPLOY = deploymentFile("sepolia-markets.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const prev = JSON.parse(fs.readFileSync(DEPLOY, "utf8"));

  const oracleAddr = ethers.getAddress(prev.contracts.oracle);
  const ratesAddr = ethers.getAddress(prev.contracts.borrowRateConfig);
  const apyAddr = ethers.getAddress(prev.contracts.staticApySource);
  const npm = ethers.getAddress(prev.external.uniswapV3Npm || SEPOLIA.uniswapV3Npm);
  const factory = ethers.getAddress(prev.external.factory || SEPOLIA.factory);
  const v4Npm = ethers.getAddress(prev.external.v4Npm || SEPOLIA.v4Npm);
  const v4StateView = ethers.getAddress(prev.external.v4StateView || SEPOLIA.v4StateView);
  const debtUsdc = ethers.getAddress(prev.external.circleUsdc || SEPOLIA.circleUsdc);
  const weth = ethers.getAddress(prev.external.weth || SEPOLIA.weth);
  const eth = ethers.ZeroAddress;
  const usdt = prev.external.usdt
    ? ethers.getAddress(prev.external.usdt)
    : addr("usdt");
  const wbtc = prev.external.wbtc
    ? ethers.getAddress(prev.external.wbtc)
    : addr("wbtc");
  const swapRouter = addr("swapRouter02");
  const creForwarder = ethers.getAddress(
    prev.external.creForwarder || SEPOLIA.creForwarder,
  );

  console.log("Debt asset (Circle USDC):", debtUsdc);
  console.log("Reusing oracle/rates/APY:", oracleAddr, ratesAddr, apyAddr);

  const V3Adapter = await ethers.getContractFactory("V3Adapter");
  const v3 = await V3Adapter.deploy(npm, factory, deployer.address);
  await v3.waitForDeployment();
  const v3Addr = await v3.getAddress();
  console.log("New V3Adapter:", v3Addr);

  const V4Adapter = await ethers.getContractFactory("V4Adapter");
  const v4 = await V4Adapter.deploy(v4Npm, v4StateView, deployer.address);
  await v4.waitForDeployment();
  const v4Addr = await v4.getAddress();
  console.log("New V4Adapter:", v4Addr);

  const MarketLendingModule = await ethers.getContractFactory("MarketLendingModule");
  const market = await MarketLendingModule.deploy(
    deployer.address,
    debtUsdc,
    oracleAddr,
    ratesAddr,
  );
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("New MarketLendingModule:", marketAddr);

  await (await market.setAdapters(v3Addr, v4Addr)).wait();
  await (await market.setApySource(apyAddr)).wait();
  await (await market.setSwapRouter(swapRouter)).wait();

  if (process.env.LIQUIDATION_FEE_BPS !== undefined && process.env.LIQUIDATION_FEE_BPS !== "") {
    const feeBps = Number(process.env.LIQUIDATION_FEE_BPS);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
      throw new Error("LIQUIDATION_FEE_BPS must be 0..10000");
    }
    await (await market.setLiquidationFeeBps(feeBps)).wait();
    console.log("liquidationFeeBps:", feeBps);
  }
  if (process.env.FEE_TO) {
    await (await market.setFeeTo(ethers.getAddress(process.env.FEE_TO))).wait();
    console.log("feeTo:", process.env.FEE_TO);
  }

  await (await v3.setLendingModule(marketAddr)).wait();
  await (await v4.setLendingModule(marketAddr)).wait();
  await (await v4.setWeth(weth)).wait();

  const oracle = await ethers.getContractAt("ValuationOracle", oracleAddr);
  await (await oracle.setAdapter(0, v3Addr)).wait();
  await (await oracle.setAdapter(1, v4Addr)).wait();
  if (prev.external.usdcUsd) {
    await (await oracle.setFeed(debtUsdc, ethers.getAddress(prev.external.usdcUsd))).wait();
  }

  const rates = await ethers.getContractAt("BorrowRateConfig", ratesAddr);
  await (await rates.setPair(debtUsdc, weth, 600, true)).wait();
  await (await rates.setPair(debtUsdc, eth, 600, false)).wait();
  await (await rates.setPair(debtUsdc, usdt, 500, true)).wait();
  await (await rates.setPair(debtUsdc, wbtc, 650, true)).wait();

  const apy = await ethers.getContractAt("StaticApySource", apyAddr);
  const pidEthV3 = pairId(debtUsdc, weth);
  const pidUsdt = pairId(debtUsdc, usdt);
  const pidWbtc = pairId(debtUsdc, wbtc);
  await (await apy.setApyBps(pidEthV3, 500)).wait();
  await (await apy.setApyBps(pidUsdt, 400)).wait();
  await (await apy.setApyBps(pidWbtc, 550)).wait();

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
  const seedHuman = process.env.FUND_PER_PAIR || "0";
  const seed = ethers.parseUnits(seedHuman, dec);

  const pairsToSeed = [
    { name: "USDC/WETH", id: pidEthV3, symbol: "lvUSDC-WETH", aprBps: 600, lenderApyBps: 500 },
    { name: "USDC/USDT", id: pidUsdt, symbol: "lvUSDC-USDT", aprBps: 500, lenderApyBps: 400 },
    { name: "USDC/WBTC", id: pidWbtc, symbol: "lvUSDC-WBTC", aprBps: 650, lenderApyBps: 550 },
  ];

  const PairVault = await ethers.getContractFactory("PairVault");
  const vaults = {};
  for (const p of pairsToSeed) {
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

  if (seedHuman !== "0" && seed > 0n) {
    const need = seed * BigInt(pairsToSeed.length);
    const bal = await debt.balanceOf(deployer.address);
    if (bal >= need) {
      for (const p of pairsToSeed) {
        await (await debt.approve(vaults[p.id], seed)).wait();
        const vault = await ethers.getContractAt("PairVault", vaults[p.id]);
        await (await vault.deposit(seed, deployer.address)).wait();
        console.log("Seeded", seedHuman, sym, "→", p.name);
      }
    } else {
      console.warn("Skipping seed — insufficient Circle USDC");
    }
  }

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

  prev.contracts.marketLendingModule = marketAddr;
  prev.contracts.v3Adapter = v3Addr;
  prev.contracts.v4Adapter = v4Addr;
  prev.contracts.creLiquidationReceiver = creReceiverAddr;
  prev.contracts.debtAsset = debtUsdc;
  prev.contracts.debtAssetDecimals = dec;
  prev.contracts.debtAssetSymbol = sym;
  prev.contracts.pairVaults = vaults;
  prev.external.circleUsdc = debtUsdc;
  prev.external.usdt = usdt;
  prev.external.wbtc = wbtc;
  prev.external.swapRouter02 = swapRouter;
  prev.external.swapRouter02Live = swapRouter;
  prev.external.creForwarder = creForwarder;
  prev.note =
    "Circle USDC debt + PairVaults. Oracle/rates/APY reused; market/adapters/vaults/CRE redeployed.";
  prev.webEnv = {
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
    VITE_SEPOLIA_VAULT_USDC_WETH: vaults[pidEthV3],
    VITE_SEPOLIA_VAULT_USDC_USDT: vaults[pidUsdt],
    VITE_SEPOLIA_VAULT_USDC_WBTC: vaults[pidWbtc],
  };
  prev.pairsEnabled = pairsToSeed.map((p) => ({
    a: "USDC",
    b: p.name.split("/")[1],
    aprBps: p.aprBps,
    lenderApyBps: p.lenderApyBps,
    pairId: p.id,
    vault: vaults[p.id],
  }));

  fs.writeFileSync(DEPLOY, JSON.stringify(prev, null, 2) + "\n");
  console.log("Updated", DEPLOY);

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

  console.log("Market:", marketAddr);
  try {
    require("./sync-addresses").main();
  } catch (e) {
    console.warn("sync-addresses skipped:", e.message || e);
    console.log("Paste webEnv from deployments/sepolia-markets.json into web/.env");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
