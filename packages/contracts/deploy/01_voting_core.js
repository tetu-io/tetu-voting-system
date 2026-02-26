const fs = require("fs");
const path = require("path");
const { loadNetworkConfig } = require("../config/loadNetworkConfig");

const PROXY_DEPLOYMENT_NAME = "VotingCoreProxy";
const IMPL_DEPLOYMENT_NAME = "VotingCore_Implementation";

function ensureSingleEoaControl(deployer, initialOwner) {
  if (deployer.toLowerCase() !== initialOwner.toLowerCase()) {
    throw new Error(
      `initialOwner (${initialOwner}) must match deployer (${deployer}) for single-EOA governance setup.`
    );
  }
}

function writeSharedArtifacts({
  networkName,
  chainId,
  deployer,
  owner,
  proxyAddress,
  implementationAddress,
  delegateRegistry,
  abi
}) {
  const sharedDir = path.resolve(__dirname, "../../shared/src");
  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }

  const deployment = {
    chainId,
    network: networkName,
    deployer,
    owner,
    votingCore: proxyAddress,
    implementation: implementationAddress,
    delegateRegistry
  };

  const deploymentPath = path.join(sharedDir, `deployment.${networkName}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2), "utf8");
  if (networkName === "localhost" || networkName === "hardhat") {
    fs.writeFileSync(path.join(sharedDir, "deployment.local.json"), JSON.stringify(deployment, null, 2), "utf8");
  }
  fs.writeFileSync(path.join(sharedDir, "voting-abi.json"), JSON.stringify(abi, null, 2), "utf8");
}

module.exports = async function deployVotingCore(hre) {
  const { artifacts, deployments, ethers, getNamedAccounts, network, upgrades } = hre;
  const { log } = deployments;
  const cfg = loadNetworkConfig(network.name);

  const { deployer } = await getNamedAccounts();
  const initialOwner = cfg.initialOwner || deployer;
  ensureSingleEoaControl(deployer, initialOwner);

  const artifact = await artifacts.readArtifact("VotingCore");
  let proxyDeployment = await deployments.getOrNull(PROXY_DEPLOYMENT_NAME);
  let action = "noop";
  let proxyAddress;
  let implementationAddress;

  if (proxyDeployment) {
    const proxyCode = await ethers.provider.getCode(proxyDeployment.address);
    if (proxyCode === "0x") {
      log(`[${network.name}] Ignoring stale deployment state for ${proxyDeployment.address} (no bytecode).`);
      proxyDeployment = null;
    }
  }

  if (!proxyDeployment && cfg.existingProxy) {
    await deployments.save(PROXY_DEPLOYMENT_NAME, {
      address: cfg.existingProxy,
      abi: artifact.abi
    });
    proxyDeployment = await deployments.get(PROXY_DEPLOYMENT_NAME);
    log(`[${network.name}] Registered existing proxy: ${cfg.existingProxy}`);
  }

  const VotingCore = await ethers.getContractFactory("VotingCore");

  if (!proxyDeployment) {
    const proxy = await upgrades.deployProxy(VotingCore, [initialOwner], { kind: "uups" });
    await proxy.waitForDeployment();
    proxyAddress = await proxy.getAddress();
    implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    await deployments.save(PROXY_DEPLOYMENT_NAME, {
      address: proxyAddress,
      abi: artifact.abi,
      transactionHash: proxy.deploymentTransaction()?.hash
    });
    await deployments.save(IMPL_DEPLOYMENT_NAME, {
      address: implementationAddress,
      abi: artifact.abi
    });
    action = "deployed";
  } else {
    proxyAddress = proxyDeployment.address;
    const currentImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    const preparedImplementation = await upgrades.prepareUpgrade(proxyAddress, VotingCore, { kind: "uups" });

    if (preparedImplementation.toLowerCase() === currentImplementation.toLowerCase()) {
      implementationAddress = currentImplementation;
      action = "noop";
      log(`[${network.name}] VotingCore implementation is up to date, skipping upgrade.`);
    } else {
      await upgrades.validateUpgrade(proxyAddress, VotingCore, { kind: "uups" });
      const upgraded = await upgrades.upgradeProxy(proxyAddress, VotingCore, { kind: "uups" });
      await upgraded.waitForDeployment();
      implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
      action = "upgraded";
      log(`[${network.name}] VotingCore proxy upgraded: ${currentImplementation} -> ${implementationAddress}`);
    }

    await deployments.save(IMPL_DEPLOYMENT_NAME, {
      address: implementationAddress,
      abi: artifact.abi
    });
  }

  if (cfg.verify && !["hardhat", "localhost"].includes(network.name)) {
    try {
      await hre.run("verify:verify", { address: implementationAddress });
      log(`[${network.name}] Implementation verified: ${implementationAddress}`);
    } catch (error) {
      log(`[${network.name}] Verification skipped/failed: ${error.message}`);
    }
  }

  if (cfg.delegateRegistry !== undefined) {
    const voting = await ethers.getContractAt("VotingCore", proxyAddress);
    const currentDelegateRegistry = await voting.delegateRegistry();
    if (currentDelegateRegistry.toLowerCase() !== cfg.delegateRegistry.toLowerCase()) {
      const tx = await voting.setDelegateRegistry(cfg.delegateRegistry);
      await tx.wait();
      log(`[${network.name}] Delegate registry updated: ${currentDelegateRegistry} -> ${cfg.delegateRegistry}`);
    }
  }

  const voting = await ethers.getContractAt("VotingCore", proxyAddress);
  const resolvedDelegateRegistry = await voting.delegateRegistry();

  if (cfg.writeSharedArtifacts) {
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    writeSharedArtifacts({
      networkName: network.name,
      chainId,
      deployer,
      owner: initialOwner,
      proxyAddress,
      implementationAddress,
      delegateRegistry: resolvedDelegateRegistry,
      abi: artifact.abi
    });
  }

  log(
    `[${network.name}] VotingCore ${action}. proxy=${proxyAddress}, implementation=${implementationAddress}, deployer=${deployer}`
  );
};

module.exports.tags = ["VotingCore", "prod"];
module.exports.id = "deploy_voting_core_uups";
