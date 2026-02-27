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

  await (await token.mint(owner.address, ethers.parseEther("100"))).wait();
  await (await token.mint(voter.address, ethers.parseEther("100"))).wait();
  await (await token.mint(proposer.address, ethers.parseEther("100"))).wait();
  await (await token.mint(other.address, ethers.parseEther("100"))).wait();

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
  const DELEGATION_ID = ethers.keccak256(ethers.toUtf8Bytes("space:1"));

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
        .createProposal(spaceId, "bad opts", "d", ["one"], BigInt(now + 1), BigInt(now + 10), false)
    ).to.be.revertedWithCustomError(voting, "InvalidOption");
    await expect(
      voting
        .connect(owner)
        .createProposal(spaceId, "bad range", "d", ["one", "two"], BigInt(now + 10), BigInt(now + 1), false)
    ).to.be.revertedWithCustomError(voting, "InvalidTimeRange");
  });

  it("allows space owner to create proposal without proposer role", async function () {
    const { voting, spaceId, owner } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, owner.address, false)).wait();
    expect(await voting.isProposer(spaceId, owner.address)).to.equal(true);

    const now = await time.latest();
    await expect(
      voting
        .connect(owner)
        .createProposal(spaceId, "owner proposal", "d", ["one", "two"], BigInt(now + 1), BigInt(now + 10), false)
    ).to.emit(voting, "ProposalCreated");
  });

  it("handles first vote and re-vote with tally replacement", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P1", "D1", ["A", "B"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();

    await expect(voting.connect(voter).vote(1, [0], [10000])).to.emit(voting, "VoteCast");
    let [_, tallies] = await voting.getProposalTallies(1);
    expect(tallies[0]).to.equal(ethers.parseEther("100"));
    expect(tallies[1]).to.equal(0);

    await expect(voting.connect(voter).vote(1, [1], [10000])).to.emit(voting, "VoteRecast");
    [_, tallies] = await voting.getProposalTallies(1);
    expect(tallies[0]).to.equal(0);
    expect(tallies[1]).to.equal(ethers.parseEther("100"));
  });

  it("supports multi-choice vote with percentage split and recast", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P2", "D2", ["A", "B", "C"], BigInt(now - 10), BigInt(now + 3600), true)
    ).wait();

    await expect(voting.connect(voter).vote(1, [0, 2], [7000, 3000])).to.emit(voting, "VoteCast");
    let [__, tallies] = await voting.getProposalTallies(1);
    expect(tallies[0]).to.equal(ethers.parseEther("70"));
    expect(tallies[1]).to.equal(0);
    expect(tallies[2]).to.equal(ethers.parseEther("30"));

    await expect(voting.connect(voter).vote(1, [1, 2], [2500, 7500])).to.emit(voting, "VoteRecast");
    [__, tallies] = await voting.getProposalTallies(1);
    expect(tallies[0]).to.equal(0);
    expect(tallies[1]).to.equal(ethers.parseEther("25"));
    expect(tallies[2]).to.equal(ethers.parseEther("75"));
  });

  it("rejects invalid multi-choice vote splits", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P3", "D3", ["A", "B", "C"], BigInt(now - 10), BigInt(now + 3600), true)
    ).wait();

    await expect(voting.connect(voter).vote(1, [], [])).to.be.revertedWithCustomError(voting, "InvalidVoteSplit");
    await expect(voting.connect(voter).vote(1, [0, 1], [5000])).to.be.revertedWithCustomError(voting, "InvalidVoteSplit");
    await expect(voting.connect(voter).vote(1, [0, 1], [5000, 4000])).to.be.revertedWithCustomError(
      voting,
      "InvalidVoteSplit"
    );
    await expect(voting.connect(voter).vote(1, [0, 0], [5000, 5000])).to.be.revertedWithCustomError(
      voting,
      "DuplicateOption"
    );
  });

  it("rejects multi-choice payload for single-choice proposal", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P4", "D4", ["A", "B", "C"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();

    await expect(voting.connect(voter).vote(1, [0, 1], [5000, 5000])).to.be.revertedWithCustomError(
      voting,
      "MultiSelectNotAllowed"
    );
  });

  it("enforces voting window boundaries", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P1", "D1", ["A", "B"], BigInt(now + 100), BigInt(now + 200), false)
    ).wait();

    await expect(voting.connect(voter).vote(1, [0], [10000])).to.be.revertedWithCustomError(voting, "ProposalNotStarted");
    await time.setNextBlockTimestamp(now + 110);
    await mine();
    await expect(voting.connect(voter).vote(1, [0], [10000])).to.emit(voting, "VoteCast");
    await time.setNextBlockTimestamp(now + 210);
    await mine();
    await expect(voting.connect(voter).vote(1, [0], [10000])).to.be.revertedWithCustomError(voting, "ProposalEnded");
  });

  it("rejects voting on deleted proposal", async function () {
    const { voting, spaceId, proposer, voter } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();
    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P1", "D1", ["A", "B"], BigInt(now - 10), BigInt(now + 200), false)
    ).wait();
    await (await voting.connect(proposer).deleteProposal(1)).wait();
    await expect(voting.connect(voter).vote(1, [0], [10000])).to.be.revertedWithCustomError(voting, "ProposalIsDeleted");
  });

  it("supports on-chain pagination for spaces and proposals", async function () {
    const { voting, spaceId, owner, token } = await loadFixture(deployFixture);
    const now = await time.latest();
    await (await voting.createSpace(await token.getAddress(), "Space 2", "Desc 2")).wait();
    await (await voting.createSpace(await token.getAddress(), "Space 3", "Desc 3")).wait();

    expect(await voting.getSpaceIdsCount()).to.equal(3);
    expect(await voting.getSpaceIdsPage(0, 2)).to.deep.equal([1n, 2n]);
    expect(await voting.getSpaceIdsPage(2, 5)).to.deep.equal([3n]);
    expect(await voting.getSpaceIdsPage(9, 2)).to.deep.equal([]);

    await (
      await voting
        .connect(owner)
        .createProposal(spaceId, "P1", "D1", ["A", "B"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();
    await (
      await voting
        .connect(owner)
        .createProposal(spaceId, "P2", "D2", ["A", "B"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();
    await (
      await voting
        .connect(owner)
        .createProposal(spaceId, "P3", "D3", ["A", "B"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();
    await (await voting.connect(owner).deleteProposal(2)).wait();

    expect(await voting.getProposalIdsBySpaceCount(spaceId, true)).to.equal(3);
    expect(await voting.getProposalIdsBySpaceCount(spaceId, false)).to.equal(2);
    expect(await voting.getProposalIdsBySpacePage(spaceId, 0, 5, true)).to.deep.equal([1n, 2n, 3n]);
    expect(await voting.getProposalIdsBySpacePage(spaceId, 0, 5, false)).to.deep.equal([1n, 3n]);
    expect(await voting.getProposalIdsBySpacePage(spaceId, 1, 5, false)).to.deep.equal([3n]);
  });

  it("indexes unique proposal voters for pagination", async function () {
    const { voting, spaceId, owner, voter, other } = await loadFixture(deployFixture);
    const now = await time.latest();
    await (
      await voting
        .connect(owner)
        .createProposal(spaceId, "P voters", "D", ["A", "B"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();

    await (await voting.connect(voter).vote(1, [0], [10000])).wait();
    await (await voting.connect(voter).vote(1, [1], [10000])).wait();
    await (await voting.connect(other).vote(1, [0], [10000])).wait();

    expect(await voting.getProposalVotersCount(1)).to.equal(2);
    const page0 = await voting.getProposalVotersPage(1, 0, 1);
    const page1 = await voting.getProposalVotersPage(1, 1, 1);
    expect(new Set([...page0, ...page1])).to.deep.equal(new Set([voter.address, other.address]));
  });

  it("retains state after UUPS upgrade", async function () {
    const { voting, spaceId, owner } = await loadFixture(deployFixture);
    const DelegateRegistry = await ethers.getContractFactory("DelegateRegistry");
    const delegateRegistry = await DelegateRegistry.deploy();
    await delegateRegistry.waitForDeployment();
    await (await voting.connect(owner).setDelegateRegistry(await delegateRegistry.getAddress())).wait();
    await (await voting.connect(owner).setSpaceDelegationId(spaceId, DELEGATION_ID)).wait();

    const V2 = await ethers.getContractFactory("VotingCoreV2");
    const upgraded = await upgrades.upgradeProxy(await voting.getAddress(), V2, {
      unsafeAllow: ["missing-initializer"]
    });
    await upgraded.waitForDeployment();
    const space = await upgraded.getSpace(spaceId);
    expect(space.id).to.equal(spaceId);
    expect(space.delegationId).to.equal(DELEGATION_ID);
    expect(await upgraded.delegateRegistry()).to.equal(await delegateRegistry.getAddress());
    expect(await upgraded.version()).to.equal("v2");
  });

  it("allows owner to set delegate registry", async function () {
    const { voting, owner, admin } = await loadFixture(deployFixture);
    const DelegateRegistry = await ethers.getContractFactory("DelegateRegistry");
    const delegateRegistry = await DelegateRegistry.deploy();
    await delegateRegistry.waitForDeployment();

    await expect(voting.connect(admin).setDelegateRegistry(await delegateRegistry.getAddress())).to.be.revertedWithCustomError(
      voting,
      "OwnableUnauthorizedAccount"
    );
    await expect(voting.connect(owner).setDelegateRegistry(await delegateRegistry.getAddress()))
      .to.emit(voting, "DelegateRegistryUpdated")
      .withArgs(await delegateRegistry.getAddress());
  });

  it("allows owner/admin to set delegation id per space and prevents reassignment", async function () {
    const { voting, owner, admin, spaceId } = await loadFixture(deployFixture);
    await (await voting.connect(owner).setAdmin(spaceId, admin.address, true)).wait();

    await expect(voting.connect(admin).setSpaceDelegationId(spaceId, DELEGATION_ID))
      .to.emit(voting, "SpaceDelegationIdUpdated")
      .withArgs(spaceId, DELEGATION_ID, admin.address);

    const otherId = ethers.keccak256(ethers.toUtf8Bytes("space:2"));
    await expect(voting.connect(owner).setSpaceDelegationId(spaceId, otherId)).to.be.revertedWithCustomError(
      voting,
      "DelegationIdAlreadySet"
    );
  });

  it("counts delegated balances in voting power and supports clear delegate", async function () {
    const { voting, owner, proposer, voter, other, spaceId } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();

    const DelegateRegistry = await ethers.getContractFactory("DelegateRegistry");
    const delegateRegistry = await DelegateRegistry.deploy();
    await delegateRegistry.waitForDeployment();
    await (await voting.connect(owner).setDelegateRegistry(await delegateRegistry.getAddress())).wait();
    await (await voting.connect(owner).setSpaceDelegationId(spaceId, DELEGATION_ID)).wait();

    await (await delegateRegistry.connect(other).setDelegate(DELEGATION_ID, voter.address)).wait();
    await expect(voting.syncDelegationForSpace(spaceId, other.address)).to.emit(voting, "SpaceDelegationSynced");
    expect(await voting.getVotingPower(spaceId, voter.address)).to.equal(ethers.parseEther("200"));

    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "P del", "D", ["A", "B"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();
    await expect(voting.connect(voter).vote(1, [0], [10000])).to.emit(voting, "VoteCast");
    const [, talliesAfterDelegate] = await voting.getProposalTallies(1);
    expect(talliesAfterDelegate[0]).to.equal(ethers.parseEther("200"));

    await (await delegateRegistry.connect(other).clearDelegate(DELEGATION_ID)).wait();
    await expect(voting.syncDelegationForSpace(spaceId, other.address)).to.emit(voting, "SpaceDelegationSynced");
    expect(await voting.getVotingPower(spaceId, voter.address)).to.equal(ethers.parseEther("100"));

    await expect(voting.connect(voter).vote(1, [1], [10000])).to.emit(voting, "VoteRecast");
    const [, talliesAfterClear] = await voting.getProposalTallies(1);
    expect(talliesAfterClear[0]).to.equal(0);
    expect(talliesAfterClear[1]).to.equal(ethers.parseEther("100"));
  });

  it("prevents double counting when voter delegates after already voting", async function () {
    const { voting, owner, proposer, voter, other, spaceId } = await loadFixture(deployFixture);
    await (await voting.setProposer(spaceId, proposer.address, true)).wait();

    const DelegateRegistry = await ethers.getContractFactory("DelegateRegistry");
    const delegateRegistry = await DelegateRegistry.deploy();
    await delegateRegistry.waitForDeployment();
    await (await voting.connect(owner).setDelegateRegistry(await delegateRegistry.getAddress())).wait();
    await (await voting.connect(owner).setSpaceDelegationId(spaceId, DELEGATION_ID)).wait();

    const now = await time.latest();
    await (
      await voting
        .connect(proposer)
        .createProposal(spaceId, "No double count", "D", ["A", "B"], BigInt(now - 10), BigInt(now + 3600), false)
    ).wait();

    await expect(voting.connect(other).vote(1, [0], [10000])).to.emit(voting, "VoteCast");
    const [, talliesAfterOtherVote] = await voting.getProposalTallies(1);
    expect(talliesAfterOtherVote[0]).to.equal(ethers.parseEther("100"));

    await (await delegateRegistry.connect(other).setDelegate(DELEGATION_ID, voter.address)).wait();
    await (await voting.syncDelegationForSpace(spaceId, other.address)).wait();

    await expect(voting.connect(voter).vote(1, [1], [10000]))
      .to.be.revertedWithCustomError(voting, "WeightAlreadyClaimed")
      .withArgs(other.address, other.address);
  });
});
