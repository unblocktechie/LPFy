/**
 * Diagnose why CRE / liquidate failed for a loan.
 *   npx hardhat run scripts/diagnose-liquidation.js --network sepolia
 * Optional: LOAN_ID=1
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const DEPLOY = path.join(__dirname, "..", "deployments", "sepolia-markets.json");

async function main() {
  const loanId = BigInt(process.env.LOAN_ID || "1");
  const [signer] = await ethers.getSigners();
  const prev = JSON.parse(fs.readFileSync(DEPLOY, "utf8"));
  const market = await ethers.getContractAt(
    "MarketLendingModule",
    prev.contracts.marketLendingModule
  );
  const receiver = await ethers.getContractAt(
    "CreLiquidationReceiver",
    prev.contracts.creLiquidationReceiver
  );
  const v3 = await ethers.getContractAt("V3Adapter", prev.contracts.v3Adapter);

  console.log("signer", signer.address);
  console.log("market", await market.getAddress());
  console.log("owner", await market.owner());
  console.log("swapRouter", await market.swapRouter());
  console.log("ltv/lt", await market.defaultLtvBps(), await market.defaultLiquidationThresholdBps());
  console.log("receiver authorized", await market.authorizedLiquidators(await receiver.getAddress()));

  const loan = await market.loans(loanId);
  console.log("loan", {
    borrower: loan.borrower,
    version: loan.version,
    tokenId: loan.tokenId.toString(),
    principal: loan.principal.toString(),
    active: loan.active,
  });
  console.log("isLiquidatable", await market.isLiquidatable(loanId));
  const debt = await market.currentDebt(loanId);
  console.log("debt", debt.map((x) => x.toString()));

  const preview = await market.previewLiquidation(loanId);
  console.log("preview", {
    liquidatable: preview.liquidatable,
    token0: preview.token0,
    token1: preview.token1,
    amount0: preview.amount0.toString(),
    amount1: preview.amount1.toString(),
    estimatedUsdc: preview.estimatedUsdc.toString(),
    debt: preview.debt.toString(),
    shortfall: preview.shortfall.toString(),
  });

  console.log("v3 owns NFT?", await v3.owns(loan.tokenId));
  console.log("npm owner", await (await ethers.getContractAt(
    ["function ownerOf(uint256) view returns (address)"],
    prev.external.uniswapV3Npm
  )).ownerOf(loan.tokenId));

  console.log("\n--- staticCall liquidate (owner) ---");
  try {
    await market.connect(signer).liquidate.staticCall(loanId);
    console.log("OK — would succeed");
  } catch (e) {
    console.log("REVERT:", e.shortMessage || e.message);
    if (e.data) {
      try {
        console.log("parsed:", market.interface.parseError(e.data));
      } catch {
        try {
          console.log("parsed v3:", v3.interface.parseError(e.data));
        } catch {
          console.log("raw data", e.data);
        }
      }
    }
    if (e.info?.error?.data) console.log("info.data", e.info.error.data);
  }

  // Try to decode CRE tx internal failure if provided
  const txHash = process.env.TX_HASH || "0xb95dcac8554e204cc27fc44ab9564e7c33b3cbcaec39b5729feb32a0ffbb5823";
  const receipt = await ethers.provider.getTransactionReceipt(txHash);
  console.log("\n--- CRE tx", txHash);
  console.log("status", receipt?.status, "logs", receipt?.logs?.length);
  if (receipt?.logs?.[0]) {
    const fwdIface = new ethers.Interface([
      "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
    ]);
    try {
      const parsed = fwdIface.parseLog(receipt.logs[0]);
      console.log("ReportProcessed", {
        receiver: parsed.args.receiver,
        result: parsed.args.result,
      });
    } catch (e) {
      console.log("log parse fail", e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
