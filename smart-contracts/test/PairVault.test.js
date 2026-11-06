const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PairVault ERC4626", function () {
  let owner, borrower, other;
  let weth, usdc, rates, market, vault, oracle, v3, v4, npm;
  let pairId;
  let tokenId;

  beforeEach(async function () {
    [owner, borrower, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const MockAggregator = await ethers.getContractFactory("MockAggregator");
    const wethFeed = await MockAggregator.deploy(8, 2000n * 10n ** 8n);
    const usdcFeed = await MockAggregator.deploy(8, 1n * 10n ** 8n);

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
      await usdc.getAddress(),
      await oracle.getAddress(),
      await rates.getAddress()
    );

    await v3.setLendingModule(await market.getAddress());
    await v4.setLendingModule(await market.getAddress());
    await market.setAdapters(await v3.getAddress(), await v4.getAddress());

    await oracle.setAdapter(0, await v3.getAddress());
    await oracle.setAdapter(1, await v4.getAddress());
    await oracle.setFeed(await weth.getAddress(), await wethFeed.getAddress());
    await oracle.setFeed(await usdc.getAddress(), await usdcFeed.getAddress());

    await rates.setPair(await weth.getAddress(), await usdc.getAddress(), 900, true);
    pairId = await rates.pairIdOf(await weth.getAddress(), await usdc.getAddress());

    const PairVault = await ethers.getContractFactory("PairVault");
    vault = await PairVault.deploy(
      await usdc.getAddress(),
      await market.getAddress(),
      pairId,
      "LPFY USDC-WETH",
      "lvUSDC-WETH"
    );
    await market.setVault(pairId, await vault.getAddress());

    await usdc.mint(owner.address, ethers.parseUnits("500000", 6));
    await usdc.approve(await vault.getAddress(), ethers.MaxUint256);

    const t0 =
      (await weth.getAddress()).toLowerCase() < (await usdc.getAddress()).toLowerCase()
        ? await weth.getAddress()
        : await usdc.getAddress();
    const t1 = t0 === (await weth.getAddress()) ? await usdc.getAddress() : await weth.getAddress();
    const amount0 = t0 === (await weth.getAddress()) ? ethers.parseEther("1") : ethers.parseUnits("2000", 6);
    const amount1 = t1 === (await weth.getAddress()) ? ethers.parseEther("1") : ethers.parseUnits("2000", 6);

    tokenId = await npm.mintPosition.staticCall(borrower.address, t0, t1, 3000, -120000, 120000, 1n);
    await npm.mintPosition(borrower.address, t0, t1, 3000, -120000, 120000, 1n);
    await npm.setTokensOwed(tokenId, amount0, amount1);
    await weth.mint(await npm.getAddress(), ethers.parseEther("10"));
    await usdc.mint(await npm.getAddress(), ethers.parseUnits("100000", 6));
    await npm.connect(borrower).approve(await v3.getAddress(), tokenId);
  });

  it("deposit mints shares and holds idle USDC", async function () {
    const amount = ethers.parseUnits("10000", 6);
    await vault.deposit(amount, owner.address);
    expect(await vault.balanceOf(owner.address)).to.equal(amount);
    expect(await vault.idleAssets()).to.equal(amount);
    expect(await vault.totalAssets()).to.equal(amount);
  });

  it("lendUsdc on market reverts UsePairVault", async function () {
    await expect(market.lendUsdc(pairId, 1n)).to.be.revertedWithCustomError(market, "UsePairVault");
  });

  it("borrow pulls idle from vault; repay pushes back", async function () {
    await vault.deposit(ethers.parseUnits("100000", 6), owner.address);
    const idleBefore = await vault.idleAssets();

    const preview = await market.previewBorrow(0, tokenId);
    const amount = preview.maxBorrowUsdc;
    expect(amount).to.be.gt(0n);

    await market.connect(borrower).borrowWithCollateral(0, tokenId, amount);
    expect(await vault.idleAssets()).to.equal(idleBefore - amount);
    expect(await market.assetsOwedToVault(pairId)).to.equal(amount);
    expect(await usdc.balanceOf(borrower.address)).to.equal(amount);

    await usdc.connect(borrower).approve(await market.getAddress(), ethers.MaxUint256);
    // Over-fund slightly in case of tiny accrual between borrow and repay
    await usdc.mint(borrower.address, ethers.parseUnits("1", 6));
    await market.connect(borrower).repay(1n, ethers.MaxUint256);

    expect(await market.assetsOwedToVault(pairId)).to.equal(0n);
    expect(await vault.idleAssets()).to.be.gte(idleBefore);
  });

  it("redeem is capped to idle cash while loans are outstanding", async function () {
    await vault.deposit(ethers.parseUnits("100000", 6), owner.address);
    const preview = await market.previewBorrow(0, tokenId);
    await market.connect(borrower).borrowWithCollateral(0, tokenId, preview.maxBorrowUsdc);

    const maxW = await vault.maxWithdraw(owner.address);
    expect(maxW).to.equal(await vault.idleAssets());
    expect(maxW).to.be.lt(await vault.convertToAssets(await vault.balanceOf(owner.address)));

    await vault.withdraw(maxW, owner.address, owner.address);
    expect(await vault.idleAssets()).to.equal(0n);
  });

  it("factory creates vault and registers on market", async function () {
    const PairVaultFactory = await ethers.getContractFactory("PairVaultFactory");
    const factory = await PairVaultFactory.deploy(
      owner.address,
      await usdc.getAddress(),
      await market.getAddress()
    );
    await market.setVaultFactory(await factory.getAddress());

    const otherPair = ethers.keccak256(ethers.toUtf8Bytes("other-pair"));
    // pairId for vault constructor is arbitrary for factory test; market only checks vault.pairId match
    const tx = await factory.createVault(otherPair, "LPFY OTHER", "lvOTHER");
    const receipt = await tx.wait();
    const created = receipt.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "VaultCreated");
    expect(created.args.pairId).to.equal(otherPair);
    expect(await market.vaultOf(otherPair)).to.equal(created.args.vault);
  });
});
