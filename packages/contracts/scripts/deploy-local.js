const path = require("path");
const fs = require("fs");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy();
  await token.waitForDeployment();

  const VotingCore = await hre.ethers.getContractFactory("VotingCore");
  const proxy = await hre.upgrades.deployProxy(VotingCore, [deployer.address], { kind: "uups" });
  await proxy.waitForDeployment();
  const votingCoreAddress = await proxy.getAddress();

  const DelegateRegistry = await hre.ethers.getContractFactory("DelegateRegistry");
  const delegateRegistry = await DelegateRegistry.deploy();
  await delegateRegistry.waitForDeployment();

  const voting = await hre.ethers.getContractAt("VotingCore", votingCoreAddress);
  await (await voting.setDelegateRegistry(await delegateRegistry.getAddress())).wait();

  const deployment = {
    chainId: 31337,
    deployer: deployer.address,
    token: await token.getAddress(),
    votingCore: votingCoreAddress,
    delegateRegistry: await delegateRegistry.getAddress()
  };

  const sharedDir = path.resolve(__dirname, "../../shared/src");
  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(sharedDir, "deployment.local.json"),
    JSON.stringify(deployment, null, 2),
    "utf8"
  );

  const artifact = await hre.artifacts.readArtifact("VotingCore");
  fs.writeFileSync(
    path.join(sharedDir, "voting-abi.json"),
    JSON.stringify(artifact.abi, null, 2),
    "utf8"
  );

  console.log("Deployment complete:", deployment);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
