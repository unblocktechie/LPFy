/**
 * Hardhat / scripts RPC — `smart-contracts/.env` only.
 * Web uses `web/.env` (VITE_*). CRE uses `cre/.env`.
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const SMART_CONTRACTS_ROOT = path.join(__dirname, "..");
const envPath = path.join(SMART_CONTRACTS_ROOT, ".env");
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

function fromEnv(name, fallback = "") {
    const v = (process.env[name] || "").trim();
    return v || fallback;
}

function requireEnv(name) {
    const v = fromEnv(name);
    if (!v) {
        throw new Error(`Missing ${name} in smart-contracts/.env`);
    }
    return v;
}

const rpc = {
    sepolia: fromEnv("SEPOLIA_RPC_URL"),
    mainnet: fromEnv("MAINNET_RPC_URL"),
    localhost: fromEnv("LOCALHOST_RPC_URL", "http://127.0.0.1:8545"),
};

module.exports = { rpc, requireEnv, fromEnv };
