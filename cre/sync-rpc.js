/**
 * Apply `cre/.env` → `cre/project.yaml` RPC URLs.
 * CRE CLI reads project.yaml; keep the URL in cre/.env as the single CRE source.
 *
 *   cd cre && node sync-rpc.js
 */
const fs = require("fs");
const path = require("path");

function loadCreEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...loadCreEnv(), ...process.env };
const url = (env.SEPOLIA_RPC_URL || "").trim();
if (!url) {
  console.error("Missing SEPOLIA_RPC_URL in cre/.env");
  process.exit(1);
}

const file = path.join(__dirname, "project.yaml");
const yaml = `# CRE project settings (Sepolia)
# RPC from cre/.env → SEPOLIA_RPC_URL (run: node sync-rpc.js)
staging-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: ${url}

production-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: ${url}
`;

fs.writeFileSync(file, yaml);
console.log("Updated cre/project.yaml RPC ->", url);
