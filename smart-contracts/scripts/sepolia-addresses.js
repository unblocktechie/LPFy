/**
 * Fixed Sepolia addresses used by deploy / ops scripts (not deployed by us).
 */
const { ethers } = require("hardhat");

const SEPOLIA = {
  circleUsdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  usdt: "0xE699A7254f05f93a539120BA640bf2D1C87b48f1",
  wbtc: "0x65bBDdD937C4CE8aCf308c0787b857664616BC2c",
  uniswapV3Npm: "0x1238536071E1c677A632429e3655c799b22cDA52",
  factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
  swapRouter02: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
  v4Npm: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
  v4StateView: "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
  ethUsd: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  usdcUsd: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
  btcUsd: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  creForwarder: "0x15fC6ae953E024d975e77382eEeC56A9101f9F88",
};

function addr(key) {
  return ethers.getAddress(SEPOLIA[key]);
}

function pairId(tokenA, tokenB) {
  const a = ethers.getAddress(tokenA);
  const b = ethers.getAddress(tokenB);
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(
    ethers.solidityPacked(["address", "address"], [x, y]),
  );
}

module.exports = { SEPOLIA, addr, pairId };
