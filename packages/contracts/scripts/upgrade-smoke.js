const path = require("path");
const fs = require("fs");
const hre = require("hardhat");

async function main() {
  const sharedDir = path.resolve(__dirname, "../../shared/src");
  const deploymentPath = path.join(sharedDir, "deployment.local.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const proxyAddress = deployment.votingCore;
  const before = await hre.ethers.getContractAt("VotingCore", proxyAddress);
  await before.getSpace(1);

  const VotingCoreV2 = await hre.ethers.getContractFactory("VotingCoreV2");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, VotingCoreV2, {
    unsafeAllow: ["missing-initializer"]
  });
  await upgraded.waitForDeployment();

  const version = await upgraded.version();
  const stillReadable = await upgraded.getSpace(1);
  if (!stillReadable.owner || version !== "v2") {
    throw new Error("Upgrade smoke check failed");
  }

  console.log("Upgrade smoke check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
