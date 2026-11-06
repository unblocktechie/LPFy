/**
 * Sync live Sepolia addresses from deployments/sepolia-markets.json into:
 *   - web/.env              (merge webEnv; keep RPC URLs)
 *   - web/.env.example      (contract keys from webEnv; keep RPC placeholders)
 *   - README.md             (Web env example block)
 *   - web/README.md         (Env example block)
 *   - cre/README.md         (Latest Sepolia deploy table)
 *
 * Usage (from smart-contracts/):
 *   node scripts/sync-addresses.js
 *   npm run sync:addresses
 *
 * Runs automatically at the end of deploy-all-sepolia / redeploy-market-per-pair-sepolia.
 */
const fs = require("fs");
const path = require("path");
const { deploymentFile, REPO_ROOT, webEnv: WEB_ENV_PATH } = require("../config/paths");

const DEPLOY = deploymentFile("sepolia-markets.json");
const ROOT_README = path.join(REPO_ROOT, "README.md");
const WEB_README = path.join(REPO_ROOT, "web", "README.md");
const WEB_ENV_EXAMPLE = path.join(REPO_ROOT, "web", ".env.example");
const CRE_README = path.join(REPO_ROOT, "cre", "README.md");

const WEB_ENV_KEY_ORDER = [
  "VITE_NETWORK",
  "VITE_SEPOLIA_MARKET_MODULE",
  "VITE_SEPOLIA_ORACLE",
  "VITE_SEPOLIA_V3_ADAPTER",
  "VITE_SEPOLIA_V4_ADAPTER",
  "VITE_SEPOLIA_USDC",
  "VITE_SEPOLIA_BORROW_RATES",
  "VITE_SEPOLIA_APY_SOURCE",
  "VITE_SEPOLIA_USDT",
  "VITE_SEPOLIA_WBTC",
  "VITE_SEPOLIA_CRE_RECEIVER",
  "VITE_SEPOLIA_VAULT_USDC_WETH",
  "VITE_SEPOLIA_VAULT_USDC_USDT",
  "VITE_SEPOLIA_VAULT_USDC_WBTC",
];

function loadDeployment() {
  if (!fs.existsSync(DEPLOY)) {
    throw new Error(`Missing ${DEPLOY} — run deploy:sepolia first`);
  }
  const data = JSON.parse(fs.readFileSync(DEPLOY, "utf8"));
  if (!data.webEnv || typeof data.webEnv !== "object") {
    throw new Error("deployments/sepolia-markets.json missing webEnv");
  }
  return data;
}

function parseEnvFile(text) {
  const map = new Map();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return map;
}

function formatWebEnvBlock(webEnv, { includeComment = false } = {}) {
  const lines = [];
  if (includeComment) {
    lines.push("# Synced from smart-contracts/deployments/sepolia-markets.json → webEnv");
  }
  for (const key of WEB_ENV_KEY_ORDER) {
    if (webEnv[key] !== undefined && webEnv[key] !== "") {
      lines.push(`${key}=${webEnv[key]}`);
    }
  }
  // Any extra webEnv keys not in the ordered list
  for (const [k, v] of Object.entries(webEnv)) {
    if (!WEB_ENV_KEY_ORDER.includes(k) && v !== undefined && v !== "") {
      lines.push(`${k}=${v}`);
    }
  }
  return lines.join("\n");
}

function syncWebDotEnv(webEnv) {
  const rpcDefaults = {
    VITE_SEPOLIA_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
    VITE_MAINNET_RPC_URL: "https://ethereum-rpc.publicnode.com",
    VITE_LOCALHOST_RPC_URL: "http://127.0.0.1:8545",
  };

  let existing = new Map();
  if (fs.existsSync(WEB_ENV_PATH)) {
    existing = parseEnvFile(fs.readFileSync(WEB_ENV_PATH, "utf8"));
  }

  const out = [];
  out.push("# Web only — synced from smart-contracts/deployments/sepolia-markets.json");
  out.push("# RPC URLs are preserved across syncs.");
  out.push("");
  out.push("VITE_NETWORK=" + (webEnv.VITE_NETWORK || existing.get("VITE_NETWORK") || "sepolia"));
  out.push("");
  out.push("# RPCs");
  for (const [k, def] of Object.entries(rpcDefaults)) {
    out.push(`${k}=${existing.get(k) || def}`);
  }
  out.push("");
  out.push("# Contracts (from webEnv)");
  for (const key of WEB_ENV_KEY_ORDER) {
    if (key === "VITE_NETWORK") continue;
    if (webEnv[key] !== undefined) out.push(`${key}=${webEnv[key]}`);
  }
  for (const [k, v] of Object.entries(webEnv)) {
    if (k === "VITE_NETWORK") continue;
    if (!WEB_ENV_KEY_ORDER.includes(k)) out.push(`${k}=${v}`);
  }
  out.push("");

  fs.mkdirSync(path.dirname(WEB_ENV_PATH), { recursive: true });
  fs.writeFileSync(WEB_ENV_PATH, out.join("\n"));
  console.log("Updated", WEB_ENV_PATH);
}

function syncWebEnvExample(webEnv) {
  const lines = [
    "# Web only — not used by Hardhat or CRE.",
    "# Contract addresses synced from deployments/sepolia-markets.json → webEnv.",
    "# Set RPCs below for the UI.",
    "",
    "VITE_NETWORK=sepolia",
    "",
    "# RPCs (change here for the UI only)",
    "VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com",
    "VITE_MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com",
    "VITE_LOCALHOST_RPC_URL=http://127.0.0.1:8545",
    "",
  ];
  for (const key of WEB_ENV_KEY_ORDER) {
    if (key === "VITE_NETWORK") continue;
    lines.push(`${key}=${webEnv[key] || ""}`);
  }
  lines.push("");
  fs.writeFileSync(WEB_ENV_EXAMPLE, lines.join("\n"));
  console.log("Updated", WEB_ENV_EXAMPLE);
}

function replaceFirstEnvFence(markdown, newEnvBody) {
  // Replace the first ```env ... ``` fence (used for Vite address examples).
  const normalized = markdown.replace(/\r\n/g, "\n");
  const re = /```env\n[\s\S]*?```/;
  if (!re.test(normalized)) {
    throw new Error("No ```env fence found to update");
  }
  return normalized.replace(re, "```env\n" + newEnvBody + "\n```");
}

function syncRootReadme(webEnv) {
  let md = fs.readFileSync(ROOT_README, "utf8");
  // Root README uses a short example — keep a compact subset + comment
  const compact = [
    `VITE_NETWORK=${webEnv.VITE_NETWORK || "sepolia"}`,
    `VITE_SEPOLIA_MARKET_MODULE=${webEnv.VITE_SEPOLIA_MARKET_MODULE || ""}`,
    `VITE_SEPOLIA_CRE_RECEIVER=${webEnv.VITE_SEPOLIA_CRE_RECEIVER || ""}`,
    `VITE_SEPOLIA_USDC=${webEnv.VITE_SEPOLIA_USDC || ""}`,
    `VITE_SEPOLIA_VAULT_USDC_WETH=${webEnv.VITE_SEPOLIA_VAULT_USDC_WETH || ""}`,
    `VITE_SEPOLIA_VAULT_USDC_USDT=${webEnv.VITE_SEPOLIA_VAULT_USDC_USDT || ""}`,
    `VITE_SEPOLIA_VAULT_USDC_WBTC=${webEnv.VITE_SEPOLIA_VAULT_USDC_WBTC || ""}`,
    "# …plus oracle, adapters, rates, APY, USDT, WBTC — or run: npm run sync:addresses",
  ].join("\n");
  md = replaceFirstEnvFence(md, compact);
  // Soften "paste manually" line if present
  md = md.replace(
    /Then refresh `web\/\.env` from `deployments\/sepolia-markets\.json` → `webEnv`\./,
    "Then run `npm run sync:addresses` (from `smart-contracts/`) to refresh `web/.env` + README examples.",
  );
  fs.writeFileSync(ROOT_README, md);
  console.log("Updated", ROOT_README);
}

function syncWebReadme(webEnv) {
  let md = fs.readFileSync(WEB_README, "utf8");
  md = replaceFirstEnvFence(md, formatWebEnvBlock(webEnv));
  md = md.replace(
    /# copy webEnv from smart-contracts\/deployments\/sepolia-markets\.json/,
    "# addresses: npm run sync:addresses (from smart-contracts/)",
  );
  fs.writeFileSync(WEB_README, md);
  console.log("Updated", WEB_README);
}

function syncCreReadme(data) {
  const c = data.contracts || {};
  const x = data.external || {};
  const vaultWeth =
    data.webEnv?.VITE_SEPOLIA_VAULT_USDC_WETH ||
    Object.values(c.pairVaults || {})[0] ||
    "";

  const table = [
    "| Contract | Address |",
    "|----------|---------|",
    `| MarketLendingModule | \`${c.marketLendingModule || ""}\` |`,
    `| CreLiquidationReceiver | \`${c.creLiquidationReceiver || ""}\` |`,
    `| Forwarder (Keystone) | \`${x.creForwarder || ""}\` |`,
    `| V3Adapter | \`${c.v3Adapter || ""}\` |`,
    `| V4Adapter | \`${c.v4Adapter || ""}\` |`,
    `| PairVault USDC/WETH | \`${vaultWeth}\` |`,
    `| SwapRouter02 | \`${x.swapRouter02 || x.swapRouter02Live || ""}\` |`,
  ].join("\n");

  let md = fs.readFileSync(CRE_README, "utf8").replace(/\r\n/g, "\n");
  const re =
    /\*\*Latest Sepolia deploy\*\*[^\n]*\n\n\| Contract \| Address \|[\s\S]*?\| SwapRouter02 \|[^\n]*\|/;
  if (!re.test(md)) {
    throw new Error("cre/README.md: Latest Sepolia deploy table not found");
  }
  md = md.replace(
    re,
    `**Latest Sepolia deploy** (see \`smart-contracts/deployments/sepolia-markets.json\`):\n\n${table}`,
  );
  fs.writeFileSync(CRE_README, md);
  console.log("Updated", CRE_README);
}

function main() {
  const data = loadDeployment();
  const webEnv = data.webEnv;
  console.log("Source:", DEPLOY);
  console.log("Market:", webEnv.VITE_SEPOLIA_MARKET_MODULE);

  syncWebDotEnv(webEnv);
  syncWebEnvExample(webEnv);
  syncRootReadme(webEnv);
  syncWebReadme(webEnv);
  syncCreReadme(data);

  console.log("\nSync complete. Restart Vite if web/.env changed.");
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

module.exports = { main };
