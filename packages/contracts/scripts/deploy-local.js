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

  const deployment = {
    chainId: 31337,
    deployer: deployer.address,
    token: await token.getAddress(),
    votingCore: await proxy.getAddress()
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
