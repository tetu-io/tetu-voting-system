const path = require("path");
const fs = require("fs");
const hre = require("hardhat");

async function main() {
  const [owner, admin, proposer, voter1, voter2] = await hre.ethers.getSigners();
  const sharedDir = path.resolve(__dirname, "../../shared/src");
  const deploymentPath = path.join(sharedDir, "deployment.local.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const token = await hre.ethers.getContractAt("MockERC20", deployment.token);
  const voting = await hre.ethers.getContractAt("VotingCore", deployment.votingCore);

  const mintAmount = hre.ethers.parseEther("1000");
  for (const account of [owner, admin, proposer, voter1, voter2]) {
    const tx = await token.mint(account.address, mintAmount);
    await tx.wait();
  }

  const createSpaceTx = await voting.createSpace(deployment.token, "Demo Space", "Seeded local test space");
  const receipt = await createSpaceTx.wait();
  const spaceEvent = receipt.logs
    .map((l) => {
      try {
        return voting.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === "SpaceCreated");
  const spaceId = spaceEvent.args.spaceId;

  await (await voting.setAdmin(spaceId, admin.address, true)).wait();
  await (await voting.setProposer(spaceId, proposer.address, true)).wait();

  const now = Math.floor(Date.now() / 1000);
  await (
    await voting.connect(proposer).createProposal(
      spaceId,
      "Active proposal",
      "Vote now",
      ["Yes", "No", "Abstain"],
      BigInt(now - 60),
      BigInt(now + 3600),
      true
    )
  ).wait();
  await (
    await voting.connect(proposer).createProposal(
      spaceId,
      "Ended proposal",
      "Voting should be closed",
      ["Option A", "Option B"],
      BigInt(now - 3600),
      BigInt(now - 60),
      false
    )
  ).wait();

  console.log("Seed complete for space", spaceId.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
