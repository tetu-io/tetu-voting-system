const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function normalizePrivateKey(rawKey) {
  if (!rawKey) {
    return null;
  }
  return rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
}

function isRetryableRpcError(error) {
  const message = (error && error.message ? error.message : String(error)).toLowerCase();
  return message.includes("unknown block");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReceiptWithRetry(provider, txHash, attempts = 20, intervalMs = 1500) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
    } catch (error) {
      if (!isRetryableRpcError(error)) {
        throw error;
      }
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for transaction receipt: ${txHash}`);
}

async function buildSignerAndProvider() {
  const networkName = hre.network.name;
  if (networkName === "hardhat" || networkName === "localhost") {
    const [signer] = await hre.ethers.getSigners();
    return { signer, provider: hre.ethers.provider };
  }

  const rpcUrl = hre.network.config.url;
  if (!rpcUrl) {
    throw new Error(`RPC url is missing for network ${networkName}`);
  }

  const privateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required for non-local deployment");
  }

  const provider = new hre.ethers.JsonRpcProvider(rpcUrl);
  const signer = new hre.ethers.Wallet(privateKey, provider);
  return { signer, provider };
}

function readDeploymentFile(deploymentPath) {
  if (!fs.existsSync(deploymentPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

function writeDeploymentFile(deploymentPath, data) {
  fs.writeFileSync(deploymentPath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const { signer, provider } = await buildSignerAndProvider();
  const deployer = await signer.getAddress();
  const networkName = hre.network.name;
  const chainId = Number((await provider.getNetwork()).chainId);

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20", signer);
  const token = await MockERC20.deploy();
  const deploymentTx = token.deploymentTransaction();
  if (!deploymentTx) {
    throw new Error("Deployment transaction hash is not available");
  }
  await waitForReceiptWithRetry(provider, deploymentTx.hash);
  const tokenAddress = await token.getAddress();

  const sharedDir = path.resolve(__dirname, "../../shared/src");
  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }

  const deploymentPath = path.join(sharedDir, `deployment.${networkName}.json`);
  const deployment = readDeploymentFile(deploymentPath);
  const nextDeployment = {
    ...deployment,
    chainId,
    network: networkName,
    deployer: deployment.deployer || deployer,
    token: tokenAddress
  };

  writeDeploymentFile(deploymentPath, nextDeployment);

  console.log("MockERC20 deployed");
  console.log(`network: ${networkName} (${chainId})`);
  console.log(`deployer: ${deployer}`);
  console.log(`token: ${tokenAddress}`);
  console.log(`deployment file updated: ${deploymentPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
