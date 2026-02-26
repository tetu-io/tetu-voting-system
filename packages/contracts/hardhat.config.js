require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("hardhat-deploy");
require("hardhat-deploy-ethers");

const path = require("path");
const { loadNetworkConfig } = require("./deploy/utils/loadNetworkConfig");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config();

function normalizePrivateKey(rawKey) {
  if (!rawKey) {
    return null;
  }
  return rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
}

function envRpcFor(networkName) {
  const envMap = {
    polygon: process.env.POLYGON_RPC_URL,
    arbitrumSepolia: process.env.ARBITRUM_SEPOLIA_RPC_URL
  };
  return envMap[networkName];
}

function buildNetworkConfig(networkName) {
  const cfg = loadNetworkConfig(networkName);
  const rpcUrl = envRpcFor(networkName) || cfg.rpcUrl;
  const privateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);

  return {
    url: rpcUrl || "http://127.0.0.1:8545",
    chainId: cfg.chainId,
    accounts: privateKey ? [privateKey] : []
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    polygon: buildNetworkConfig("polygon"),
    arbitrumSepolia: buildNetworkConfig("arbitrumSepolia")
  },
  namedAccounts: {
    deployer: {
      default: 0
    }
  },
  paths: {
    deploy: "deploy",
    deployments: "deployments"
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || ""
    }
  }
};
