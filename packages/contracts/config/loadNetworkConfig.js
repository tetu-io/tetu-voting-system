const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

function resolveConfigFile(networkName) {
  const configDir = path.resolve(__dirname, "../deploy-config");
  return path.join(configDir, `${networkName}.yaml`);
}

function assertAddress(value, fieldName, filePath) {
  if (!value) {
    return;
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid ${fieldName} in ${filePath}: ${value}`);
  }
}

function loadNetworkConfig(networkName) {
  const filePath = resolveConfigFile(networkName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing deploy config file for network "${networkName}": ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const config = yaml.load(raw) ?? {};

  if (typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Invalid YAML structure in ${filePath}: expected an object`);
  }
  if (!Number.isInteger(config.chainId) || config.chainId <= 0) {
    throw new Error(`Invalid or missing chainId in ${filePath}`);
  }
  if (config.rpcUrl !== undefined && typeof config.rpcUrl !== "string") {
    throw new Error(`Invalid rpcUrl in ${filePath}: expected string`);
  }
  if (config.confirmations !== undefined && (!Number.isInteger(config.confirmations) || config.confirmations < 0)) {
    throw new Error(`Invalid confirmations in ${filePath}: expected non-negative integer`);
  }
  if (
    config.deploymentTimeoutMs !== undefined &&
    (!Number.isInteger(config.deploymentTimeoutMs) || config.deploymentTimeoutMs <= 0)
  ) {
    throw new Error(`Invalid deploymentTimeoutMs in ${filePath}: expected positive integer`);
  }
  if (
    config.deploymentPollingIntervalMs !== undefined &&
    (!Number.isInteger(config.deploymentPollingIntervalMs) || config.deploymentPollingIntervalMs <= 0)
  ) {
    throw new Error(`Invalid deploymentPollingIntervalMs in ${filePath}: expected positive integer`);
  }
  if (config.verify !== undefined && typeof config.verify !== "boolean") {
    throw new Error(`Invalid verify in ${filePath}: expected boolean`);
  }
  if (config.writeSharedArtifacts !== undefined && typeof config.writeSharedArtifacts !== "boolean") {
    throw new Error(`Invalid writeSharedArtifacts in ${filePath}: expected boolean`);
  }

  assertAddress(config.initialOwner, "initialOwner", filePath);
  assertAddress(config.existingProxy, "existingProxy", filePath);
  assertAddress(config.delegateRegistry, "delegateRegistry", filePath);

  return {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    confirmations: config.confirmations ?? 1,
    deploymentTimeoutMs: config.deploymentTimeoutMs ?? 300000,
    deploymentPollingIntervalMs: config.deploymentPollingIntervalMs ?? 5000,
    verify: config.verify ?? false,
    writeSharedArtifacts: config.writeSharedArtifacts ?? true,
    initialOwner: config.initialOwner,
    existingProxy: config.existingProxy,
    delegateRegistry: config.delegateRegistry
  };
}

module.exports = {
  loadNetworkConfig
};
