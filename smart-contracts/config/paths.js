/**
 * Repo-relative paths from smart-contracts package.
 * Scripts live in smart-contracts/scripts — use this instead of fragile ../../ chains.
 */
const path = require("path");

const SMART_CONTRACTS_ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(SMART_CONTRACTS_ROOT, "..");

module.exports = {
    SMART_CONTRACTS_ROOT,
    REPO_ROOT,
    deploymentsDir: path.join(SMART_CONTRACTS_ROOT, "deployments"),
    deploymentFile: (name) =>
        path.join(SMART_CONTRACTS_ROOT, "deployments", name),
    frontendRoot: path.join(REPO_ROOT, "web"),
    frontendEnv: path.join(REPO_ROOT, "web", ".env"),
    frontendLib: (...parts) =>
        path.join(REPO_ROOT, "web", "src", "lib", ...parts),
    creRoot: path.join(REPO_ROOT, "cre"),
    creKeeperConfig: (file) =>
        path.join(REPO_ROOT, "cre", "liquidation-keeper", file),
};
