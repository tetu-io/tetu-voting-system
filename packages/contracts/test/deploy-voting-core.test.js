const { expect } = require("chai");
const hre = require("hardhat");

describe("hardhat-deploy VotingCore", function () {
  it("deploys once and stays idempotent on repeated runs", async function () {
    const { deployments, ethers, upgrades } = hre;

    await hre.run("deploy", { tags: "VotingCore" });
    const firstProxy = await deployments.get("VotingCoreProxy");
    const firstImpl = await upgrades.erc1967.getImplementationAddress(firstProxy.address);

    await hre.run("deploy", { tags: "VotingCore" });
    const secondProxy = await deployments.get("VotingCoreProxy");
    const secondImpl = await upgrades.erc1967.getImplementationAddress(secondProxy.address);

    expect(secondProxy.address).to.equal(firstProxy.address);
    expect(secondImpl).to.equal(firstImpl);

    const [deployer] = await ethers.getSigners();
    const voting = await ethers.getContractAt("VotingCore", firstProxy.address);
    expect(await voting.owner()).to.equal(deployer.address);
  });
});
