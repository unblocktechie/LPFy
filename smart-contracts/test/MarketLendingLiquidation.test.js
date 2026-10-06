const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MarketLendingModule liquidation", function () {
  const FEE = 3000;
  const LTV_BPS = 5000;
  const LT_BPS = 6500;

  let owner, borrower, liquidator;
  let weth, usdc;
  let wethFeed, usdcFeed;
  let npm, oracle, v3, v4, rates, market, router, vault;
  let token0, token1;
  let tokenId;
  let pairId;

  async function deployVaultAndSeed(amount) {
    const PairVault = await ethers.getContractFactory("PairVault");
    vault = await PairVault.deploy(
      await usdc.getAddress(),
      await market.getAddress(),
      pairId,
      "LPFY USDC-WETH",
      "lvUSDC-WETH"
    );
    await market.setVault(pairId, await vault.getAddress());
    await usdc.approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.deposit(amount, owner.address);
  }

  beforeEach(async function () {
    [owner, borrower, liquidator] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const MockAggregator = await ethers.getContractFactory("MockAggregator");
    wethFeed = await MockAggregator.deploy(8, 2000n * 10n ** 8n);
    usdcFeed = await MockAggregator.deploy(8, 1n * 10n ** 8n);

    const wethAddr = await weth.getAddress();
    const usdcAddr = await usdc.getAddress();
    if (wethAddr.toLowerCase() < usdcAddr.toLowerCase()) {
      token0 = weth;
      token1 = usdc;
    } else {
      token0 = usdc;
      token1 = weth;
    }

    const MockNPM = await ethers.getContractFactory("MockNPM");
    npm = await MockNPM.deploy();

    const ValuationOracle = await ethers.getContractFactory("ValuationOracle");
    oracle = await ValuationOracle.deploy(owner.address);

    const V3Adapter = await ethers.getContractFactory("V3Adapter");
    v3 = await V3Adapter.deploy(await npm.getAddress(), ethers.ZeroAddress, owner.address);

    const V4Adapter = await ethers.getContractFactory("V4Adapter");
    v4 = await V4Adapter.deploy(ethers.ZeroAddress, ethers.ZeroAddress, owner.address);

    const BorrowRateConfig = await ethers.getContractFactory("BorrowRateConfig");
    rates = await BorrowRateConfig.deploy(owner.address);

    const MarketLendingModule = await ethers.getContractFactory("MarketLendingModule");
    market = await MarketLendingModule.deploy(
      owner.address,
      usdcAddr,
      await oracle.getAddress(),
      await rates.getAddress()
    );

    const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
    router = await MockSwapRouter.deploy();

    await v3.setLendingModule(await market.getAddress());
    await v4.setLendingModule(await market.getAddress());
    await market.setAdapters(await v3.getAddress(), await v4.getAddress());
    await market.setSwapRouter(await router.getAddress());
    await market.setDefaultLtvBps(LTV_BPS);
    await market.setDefaultLiquidationThresholdBps(LT_BPS);

    await oracle.setAdapter(0, await v3.getAddress());
    await oracle.setAdapter(1, await v4.getAddress());
    await oracle.setFeed(wethAddr, await wethFeed.getAddress());
    await oracle.setFeed(usdcAddr, await usdcFeed.getAddress());

    await rates.setPair(wethAddr, usdcAddr, 900, true);
    pairId = await rates.pairIdOf(wethAddr, usdcAddr);

    // Seed lender pool via PairVault
    await usdc.mint(owner.address, ethers.parseUnits("1000000", 6));
    await deployVaultAndSeed(ethers.parseUnits("100000", 6));

    // Mint LP NFT to borrower: tiny liquidity + collectable 1 WETH + 2000 USDC
    const amount0 =
      (await token0.getAddress()) === wethAddr
        ? ethers.parseEther("1")
        : ethers.parseUnits("2000", 6);
    const amount1 =
      (await token1.getAddress()) === wethAddr
        ? ethers.parseEther("1")
        : ethers.parseUnits("2000", 6);

    tokenId = await npm.mintPosition.staticCall(
      borrower.address,
      await token0.getAddress(),
      await token1.getAddress(),
      FEE,
      -120000,
      120000,
      1n
    );
    await npm.mintPosition(
      borrower.address,
      await token0.getAddress(),
      await token1.getAddress(),
      FEE,
      -120000,
      120000,
      1n
    );
    await npm.setTokensOwed(tokenId, amount0, amount1);

    // Fund NPM so collect can transfer
    await weth.mint(await npm.getAddress(), ethers.parseEther("10"));
    await usdc.mint(await npm.getAddress(), ethers.parseUnits("100000", 6));

    // Fund router for WETH -> USDC swaps
    await usdc.mint(await router.getAddress(), ethers.parseUnits("500000", 6));

    await npm.connect(borrower).approve(await v3.getAddress(), tokenId);
  });

  async function borrowMaxNearLtv() {
    const preview = await market.previewBorrow(0, tokenId);
    const amount = preview.maxBorrowUsdc;
    await market.connect(borrower).borrowWithCollateral(0, tokenId, amount);
    return amount;
  }

  it("previewLiquidation shows healthy loan as not liquidatable", async function () {
    await borrowMaxNearLtv();
    const loanId = 1n;
    const preview = await market.previewLiquidation(loanId);
    expect(preview.liquidatable).to.equal(false);
    expect(await market.isLiquidatable(loanId)).to.equal(false);
  });

  it("reverts liquidate while still healthy", async function () {
    await borrowMaxNearLtv();
    await expect(market.connect(owner).liquidate(1n)).to.be.revertedWithCustomError(
      market,
      "StillHealthy"
    );
  });

  it("rejects liquidate from unauthorized caller", async function () {
    await borrowMaxNearLtv();
    await wethFeed.setAnswer(100n * 10n ** 8n);
    await expect(market.connect(liquidator).liquidate(1n)).to.be.revertedWithCustomError(
      market,
      "NotLiquidationAuthority"
    );
  });

  it("liquidates underwater V3 loan: unwind, swap, repay pool, surplus to borrower", async function () {
    const borrowed = await borrowMaxNearLtv();
    const loanId = 1n;

    // Crash WETH so collateral falls under LT
    await wethFeed.setAnswer(100n * 10n ** 8n);

    const preview = await market.previewLiquidation(loanId);
    expect(preview.liquidatable).to.equal(true);
    expect(preview.debt).to.be.gte(borrowed);

    const borrowerUsdcBefore = await usdc.balanceOf(borrower.address);
    const poolBefore = await market.pools(pairId);
    const vaultIdleBefore = await vault.idleAssets();

    // Owner (admin) may liquidate
    await market.connect(owner).liquidate(loanId);

    const loan = await market.loans(loanId);
    expect(loan.active).to.equal(false);
    expect(loan.principal).to.equal(0n);

    const poolAfter = await market.pools(pairId);
    expect(poolAfter.totalPrincipal).to.be.lt(poolBefore.totalPrincipal);
    expect(await vault.idleAssets()).to.be.gt(vaultIdleBefore);

    // Empty NFT returned to borrower
    expect(await npm.ownerOf(tokenId)).to.equal(borrower.address);

    // Surplus (if any) lands on borrower when the fee is 0
    const borrowerUsdcAfter = await usdc.balanceOf(borrower.address);
    expect(borrowerUsdcAfter).to.be.gte(borrowerUsdcBefore);
  });

  it("sends a share of liquidation surplus to feeTo (not necessarily owner)", async function () {
    const [, , , feeRecipient] = await ethers.getSigners();
    await market.setFeeTo(feeRecipient.address);
    await market.setLiquidationFeeBps(2500);
    await borrowMaxNearLtv();
    await wethFeed.setAnswer(100n * 10n ** 8n);

    const borrowerBefore = await usdc.balanceOf(borrower.address);
    const feeBefore = await usdc.balanceOf(feeRecipient.address);
    const ownerBefore = await usdc.balanceOf(owner.address);

    await market.connect(owner).liquidate(1n);

    const borrowerGain = (await usdc.balanceOf(borrower.address)) - borrowerBefore;
    const feeGain = (await usdc.balanceOf(feeRecipient.address)) - feeBefore;
    const ownerGain = (await usdc.balanceOf(owner.address)) - ownerBefore;
    const surplus = borrowerGain + feeGain;
    expect(surplus).to.be.gt(0n);
    expect(feeGain).to.equal((surplus * 2500n) / 10_000n);
    expect(borrowerGain).to.equal(surplus - feeGain);
    expect(ownerGain).to.equal(0n);
  });

  it("uses live global LT — lowering threshold makes max-borrow liquidatable", async function () {
    await borrowMaxNearLtv();
    const loanId = 1n;

    expect(await market.isLiquidatable(loanId)).to.equal(false);

    // LT must stay >= LTV: drop both so threshold sits under current ~50% debt ratio.
    await market.setDefaultLtvBps(4000);
    await market.setDefaultLiquidationThresholdBps(4500);

    expect(await market.isLiquidatable(loanId)).to.equal(true);
    const preview = await market.previewLiquidation(loanId);
    expect(preview.liquidatable).to.equal(true);

    await market.connect(owner).liquidate(loanId);
    expect((await market.loans(loanId)).active).to.equal(false);
  });

  it("allows authorized CRE receiver to liquidate via onReport", async function () {
    await borrowMaxNearLtv();
    await wethFeed.setAnswer(100n * 10n ** 8n);

    const forwarder = liquidator;
    const CreLiquidationReceiver = await ethers.getContractFactory("CreLiquidationReceiver");
    const receiver = await CreLiquidationReceiver.deploy(
      owner.address,
      forwarder.address,
      await market.getAddress()
    );
    await market.setAuthorizedLiquidator(await receiver.getAddress(), true);

    const loanId = 1n;
    const report = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [loanId]);
    await receiver.connect(forwarder).onReport("0x", report);

    const loan = await market.loans(loanId);
    expect(loan.active).to.equal(false);
  });
});

describe("MarketLendingModule V4 liquidation", function () {
  const FEE = 3000;
  const TICK_SPACING = 60;
  const LTV_BPS = 5000;
  const LT_BPS = 6500;

  let owner, borrower, liquidator;
  let weth, usdc;
  let wethFeed, usdcFeed;
  let oracle, v3, v4, rates, market, router, vault;
  let token0, token1;
  let tokenId;
  let pairId;

  async function deployVaultAndSeed(amount) {
    const PairVault = await ethers.getContractFactory("PairVault");
    vault = await PairVault.deploy(
      await usdc.getAddress(),
      await market.getAddress(),
      pairId,
      "LPFY USDC-WETH",
      "lvUSDC-WETH"
    );
    await market.setVault(pairId, await vault.getAddress());
    await usdc.approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.deposit(amount, owner.address);
  }

  beforeEach(async function () {
    [owner, borrower, liquidator] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const MockAggregator = await ethers.getContractFactory("MockAggregator");
    wethFeed = await MockAggregator.deploy(8, 2000n * 10n ** 8n);
    usdcFeed = await MockAggregator.deploy(8, 1n * 10n ** 8n);

    const wethAddr = await weth.getAddress();
    const usdcAddr = await usdc.getAddress();
    if (wethAddr.toLowerCase() < usdcAddr.toLowerCase()) {
      token0 = weth;
      token1 = usdc;
    } else {
      token0 = usdc;
      token1 = weth;
    }

    const MockNPM = await ethers.getContractFactory("MockNPM");
    const npm = await MockNPM.deploy();

    const ValuationOracle = await ethers.getContractFactory("ValuationOracle");
    oracle = await ValuationOracle.deploy(owner.address);

    const V3Adapter = await ethers.getContractFactory("V3Adapter");
    v3 = await V3Adapter.deploy(await npm.getAddress(), ethers.ZeroAddress, owner.address);

    // registerPosition path (no live PositionManager) — valuation includes tokensOwed
    const V4Adapter = await ethers.getContractFactory("V4Adapter");
    v4 = await V4Adapter.deploy(ethers.ZeroAddress, ethers.ZeroAddress, owner.address);
    await v4.setWeth(wethAddr);

    const BorrowRateConfig = await ethers.getContractFactory("BorrowRateConfig");
    rates = await BorrowRateConfig.deploy(owner.address);

    const MarketLendingModule = await ethers.getContractFactory("MarketLendingModule");
    market = await MarketLendingModule.deploy(
      owner.address,
      usdcAddr,
      await oracle.getAddress(),
      await rates.getAddress()
    );

    const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
    router = await MockSwapRouter.deploy();

    await v3.setLendingModule(await market.getAddress());
    await v4.setLendingModule(await market.getAddress());
    await market.setAdapters(await v3.getAddress(), await v4.getAddress());
    await market.setSwapRouter(await router.getAddress());
    await market.setDefaultLtvBps(LTV_BPS);
    await market.setDefaultLiquidationThresholdBps(LT_BPS);

    await oracle.setAdapter(0, await v3.getAddress());
    await oracle.setAdapter(1, await v4.getAddress());
    await oracle.setFeed(wethAddr, await wethFeed.getAddress());
    await oracle.setFeed(usdcAddr, await usdcFeed.getAddress());

    await rates.setPair(wethAddr, usdcAddr, 900, true);
    pairId = await rates.pairIdOf(wethAddr, usdcAddr);

    await usdc.mint(owner.address, ethers.parseUnits("1000000", 6));
    await deployVaultAndSeed(ethers.parseUnits("100000", 6));

    const amount0 =
      (await token0.getAddress()) === wethAddr
        ? ethers.parseEther("1")
        : ethers.parseUnits("2000", 6);
    const amount1 =
      (await token1.getAddress()) === wethAddr
        ? ethers.parseEther("1")
        : ethers.parseUnits("2000", 6);

    tokenId = 42;
    await v4.registerPosition(
      tokenId,
      await token0.getAddress(),
      await token1.getAddress(),
      FEE,
      TICK_SPACING,
      ethers.ZeroAddress,
      -120000,
      120000,
      1n
    );
    await v4.setTokensOwed(tokenId, amount0, amount1);

    // Fund adapter so registered unwind can transfer
    await weth.mint(await v4.getAddress(), ethers.parseEther("10"));
    await usdc.mint(await v4.getAddress(), ethers.parseUnits("100000", 6));
    await usdc.mint(await router.getAddress(), ethers.parseUnits("500000", 6));
  });

  async function borrowMaxNearLtvV4() {
    const preview = await market.previewBorrow(1, tokenId);
    const amount = preview.maxBorrowUsdc;
    await market.connect(borrower).borrowWithCollateral(1, tokenId, amount);
    return amount;
  }

  it("liquidates underwater V4 loan (register unwind path)", async function () {
    const borrowed = await borrowMaxNearLtvV4();
    const loanId = 1n;

    await wethFeed.setAnswer(100n * 10n ** 8n);

    const preview = await market.previewLiquidation(loanId);
    expect(preview.liquidatable).to.equal(true);
    expect(preview.debt).to.be.gte(borrowed);

    await market.connect(owner).liquidate(loanId);

    const loan = await market.loans(loanId);
    expect(loan.active).to.equal(false);
    expect(loan.principal).to.equal(0n);
    expect(await v4.owns(tokenId)).to.equal(false);
  });

  it("CRE onReport liquidates underwater V4 loan", async function () {
    await borrowMaxNearLtvV4();
    await wethFeed.setAnswer(100n * 10n ** 8n);

    const forwarder = liquidator;
    const CreLiquidationReceiver = await ethers.getContractFactory("CreLiquidationReceiver");
    const receiver = await CreLiquidationReceiver.deploy(
      owner.address,
      forwarder.address,
      await market.getAddress()
    );
    await market.setAuthorizedLiquidator(await receiver.getAddress(), true);

    const loanId = 1n;
    const report = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [loanId]);
    await receiver.connect(forwarder).onReport("0x", report);

    const loan = await market.loans(loanId);
    expect(loan.active).to.equal(false);
  });
});

describe("V4Adapter live unwind (Mock PositionManager)", function () {
  it("modifyLiquidities decrease + takePair then transfers empty NFT", async function () {
    const [owner, borrower, recipient] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("A", "A", 18);
    const tokenB = await MockERC20.deploy("B", "B", 18);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();
    const [currency0, currency1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    const t0 = currency0 === a ? tokenA : tokenB;
    const t1 = currency1 === a ? tokenA : tokenB;

    const MockV4PositionManager = await ethers.getContractFactory("MockV4PositionManager");
    const posm = await MockV4PositionManager.deploy();

    const V4Adapter = await ethers.getContractFactory("V4Adapter");
    const v4 = await V4Adapter.deploy(await posm.getAddress(), ethers.ZeroAddress, owner.address);
    await v4.setLendingModule(owner.address);

    const tokenId = await posm.mintPosition.staticCall(
      borrower.address,
      currency0,
      currency1,
      3000,
      60,
      ethers.ZeroAddress,
      -120000,
      120000,
      1000n
    );
    await posm.mintPosition(
      borrower.address,
      currency0,
      currency1,
      3000,
      60,
      ethers.ZeroAddress,
      -120000,
      120000,
      1000n
    );

    const amount0 = ethers.parseEther("1");
    const amount1 = ethers.parseEther("2");
    await posm.setTokensOwed(tokenId, amount0, amount1);
    await t0.mint(await posm.getAddress(), amount0);
    await t1.mint(await posm.getAddress(), amount1);

    await posm.connect(borrower).approve(await v4.getAddress(), tokenId);
    await v4.deposit(borrower.address, tokenId);

    const before0 = await t0.balanceOf(recipient.address);
    const before1 = await t1.balanceOf(recipient.address);

    const result = await v4.unwind.staticCall(tokenId, recipient.address, borrower.address);
    await v4.unwind(tokenId, recipient.address, borrower.address);

    expect(result[0]).to.equal(currency0);
    expect(result[1]).to.equal(currency1);
    expect(result[2]).to.equal(amount0);
    expect(result[3]).to.equal(amount1);
    expect(await t0.balanceOf(recipient.address)).to.equal(before0 + amount0);
    expect(await t1.balanceOf(recipient.address)).to.equal(before1 + amount1);
    expect(await posm.ownerOf(tokenId)).to.equal(borrower.address);
    expect(await posm.getPositionLiquidity(tokenId)).to.equal(0n);
    expect(await v4.owns(tokenId)).to.equal(false);
  });
});
