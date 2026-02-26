const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-network-helpers");

async function deployFixture() {
  const [owner, admin, proposer, voter, other] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy();
  await token.waitForDeployment();

  const Voting = await ethers.getContractFactory("VotingCore");
  const voting = await upgrades.deployProxy(Voting, [owner.address], { kind: "uups" });
  await voting.waitForDeployment();

  await (await token.mint(voter.address, ethers.parseEther("100"))).wait();
  await (await token.mint(proposer.address, ethers.parseEther("100"))).wait();

  const tx = await voting.createSpace(await token.getAddress(), "Space", "Desc");
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((l) => {
      try {
        return voting.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === "SpaceCreated");
  const spaceId = event.args.spaceId;

  return { owner, admin, proposer, voter, other, token, voting, spaceId };
}

describe("VotingCore", function () {
  it("allows owner to assign admin and proposer", async function () {
    const { voting, spaceId, admin, proposer } = await loadFixture(deployFixture);

    await expect(voting.setAdmin(spaceId, admin.address, true))
      .to.emit(voting, "SpaceAdminUpdated")
      .withArgs(spaceId, admin.address, true);
    await expect(voting.connect(admin).setProposer(spaceId, proposer.address, true))
      .to.emit(voting, "SpaceProposerUpdated")
      .withArgs(spaceId, proposer.address, true);
  });

  it("rejects non-owner admin updates", async function () {
    const { voting, spaceId, proposer, admin } = await loadFixture(deployFixture);
    await expect(voting.connect(proposer).setAdmin(spaceId, admin.address, true)).to.be.revertedWithCustomError(
      voting,
      "Unauthorized"
    );
  });

  it("validates proposal creation rules", async function () {
    const { voting, spaceId, proposer, owner } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();

    await expect(
      voting
        .connect(owner)
        .createProposal(spaceId, "bad opts", "d", ["one"], BigInt(now + 1), BigInt(now + 10))
    ).to.be.revertedWithCustomError(voting, "InvalidOption");
    await expect(
      voting
        .connect(owner)
        .createProposal(spaceId, "bad range", "d", ["one", "two"], BigInt(now + 10), BigInt(now + 1))
    ).to.be.revertedWithCustomError(voting, "InvalidTimeRange");
  });

  it("handles first vote and re-vote with tally replacement", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P1", "D1", ["A", "B"], BigInt(now - 10), BigInt(now + 3600))
    ).wait();

    await expect(voting.connect(voter).vote(1, 0)).to.emit(voting, "VoteCast");
    let [_, tallies] = await voting.getProposalTallies(1);
    expect(tallies[0]).to.equal(ethers.parseEther("100"));
    expect(tallies[1]).to.equal(0);

    await expect(voting.connect(voter).vote(1, 1)).to.emit(voting, "VoteRecast");
    [_, tallies] = await voting.getProposalTallies(1);
    expect(tallies[0]).to.equal(0);
    expect(tallies[1]).to.equal(ethers.parseEther("100"));
  });

  it("enforces voting window boundaries", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P1", "D1", ["A", "B"], BigInt(now + 100), BigInt(now + 200))
    ).wait();

    await expect(voting.connect(voter).vote(1, 0)).to.be.revertedWithCustomError(voting, "ProposalNotStarted");
    await time.setNextBlockTimestamp(now + 110);
    await mine();
    await expect(voting.connect(voter).vote(1, 0)).to.emit(voting, "VoteCast");
    await time.setNextBlockTimestamp(now + 210);
    await mine();
    await expect(voting.connect(voter).vote(1, 0)).to.be.revertedWithCustomError(voting, "ProposalEnded");
  });

  it("rejects voting on deleted proposal", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P1", "D1", ["A", "B"], BigInt(now - 10), BigInt(now + 200))
    ).wait();
    await (await voting.connect(proposer).deleteProposal(1)).wait();
    await expect(voting.connect(voter).vote(1, 0)).to.be.revertedWithCustomError(voting, "ProposalIsDeleted");
  });

  it("retains state after UUPS upgrade", async function () {
    const { voting, spaceId } = await loadFixture(deployFixture);
    const V2 = await ethers.getContractFactory("VotingCoreV2");
    const upgraded = await upgrades.upgradeProxy(await voting.getAddress(), V2, {
      unsafeAllow: ["missing-initializer"]
    });
    await upgraded.waitForDeployment();
    const space = await upgraded.getSpace(spaceId);
    expect(space.id).to.equal(spaceId);
    expect(await upgraded.version()).to.equal("v2");
  });
});
