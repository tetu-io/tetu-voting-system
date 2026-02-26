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
    throw new Error("DEPLOYER_PRIVATE_KEY is required for non-local mint");
  }

  const provider = new hre.ethers.JsonRpcProvider(rpcUrl);
  const signer = new hre.ethers.Wallet(privateKey, provider);
  return { signer, provider };
}

function parseArgs(argv) {
  const positional = [];
  let tokenAddressFromFlag;

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--token") {
      tokenAddressFromFlag = argv[i + 1];
      i += 1;
      continue;
    }
    positional.push(value);
  }

  return {
    to: process.env.MINT_TO || positional[0],
    amount: process.env.MINT_AMOUNT || positional[1] || "1000",
    tokenAddressFromFlag
  };
}

function readTokenFromSharedDeployment(networkName) {
  const deploymentPath = path.resolve(__dirname, `../../shared/src/deployment.${networkName}.json`);
  if (!fs.existsSync(deploymentPath)) {
    return null;
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  return deployment.token || null;
}

async function main() {
  const { to, amount, tokenAddressFromFlag } = parseArgs(process.argv.slice(2));
  if (!to) {
    throw new Error(
      "Usage: MINT_TO=<address> MINT_AMOUNT=<amount> MINT_TOKEN=<tokenAddress> hardhat run scripts/mint-mock-token.js --network arbitrumSepolia"
    );
  }
  if (!hre.ethers.isAddress(to)) {
    throw new Error(`Invalid recipient address: ${to}`);
  }

  const networkName = hre.network.name;
  const tokenAddress = process.env.MINT_TOKEN || tokenAddressFromFlag || readTokenFromSharedDeployment(networkName);
  if (!tokenAddress) {
    throw new Error(
      `Token address is not provided. Pass --token <address> or deploy token first and store it in shared/src/deployment.${networkName}.json`
    );
  }
  if (!hre.ethers.isAddress(tokenAddress)) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }

  const { signer, provider } = await buildSignerAndProvider();
  const token = await hre.ethers.getContractAt("MockERC20", tokenAddress, signer);
  const amountWei = hre.ethers.parseUnits(amount, 18);

  const tx = await token.mint(to, amountWei);
  await waitForReceiptWithRetry(provider, tx.hash);

  console.log("Mint complete");
  console.log(`network: ${networkName}`);
  console.log(`token: ${tokenAddress}`);
  console.log(`to: ${to}`);
  console.log(`amount: ${amount} MVT`);
  console.log(`tx: ${tx.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
