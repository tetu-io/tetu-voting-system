const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const BPS_DENOMINATOR = 10_000n;
const DELEGATION_ID = ethers.keccak256(ethers.toUtf8Bytes("space:1"));

function createSeededRng(seed) {
  let state = BigInt(seed) & ((1n << 64n) - 1n);
  return {
    nextU64() {
      // Deterministic PRNG to keep CI runs stable.
      state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return state;
    },
    nextInt(maxExclusive) {
      if (maxExclusive <= 0) {
        return 0;
      }
      return Number(this.nextU64() % BigInt(maxExclusive));
    }
  };
}

function pickUniqueOptionIndices(optionCount, picks, rng) {
  const options = Array.from({ length: optionCount }, (_, i) => i);
  for (let i = options.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options.slice(0, picks).map((n) => Number(n));
}

function buildValidSplit(picks, rng) {
  if (picks === 1) {
    return [Number(BPS_DENOMINATOR)];
  }

  const weights = [];
  let remaining = Number(BPS_DENOMINATOR);
  for (let i = 0; i < picks - 1; i++) {
    const minReservedForTail = picks - i - 1;
    const maxForCurrent = remaining - minReservedForTail;
    const portion = 1 + rng.nextInt(maxForCurrent);
    weights.push(portion);
    remaining -= portion;
  }
  weights.push(remaining);
  return weights;
}

function randomPayload(optionCount, allowMultiChoice, rng) {
  const picks = allowMultiChoice ? 1 + rng.nextInt(optionCount) : 1;
  const optionIndices = pickUniqueOptionIndices(optionCount, picks, rng);
  const weightsBps = buildValidSplit(picks, rng);
  return { optionIndices, weightsBps };
}

function computeDistributedWeights(totalWeight, weightsBps) {
  const distributed = [];
  let allocated = 0n;
  for (let i = 0; i < weightsBps.length; i++) {
    const portion =
      i === weightsBps.length - 1
        ? totalWeight - allocated
        : (totalWeight * BigInt(weightsBps[i])) / BPS_DENOMINATOR;
    distributed.push(portion);
    allocated += portion;
  }
  return distributed;
}

function sumBigInts(values) {
  return values.reduce((acc, value) => acc + value, 0n);
}

async function deployFixture() {
  const signers = await ethers.getSigners();
  const [owner, proposer] = signers;
  const voters = signers.slice(2, 10);

  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy();
  await token.waitForDeployment();

  const Voting = await ethers.getContractFactory("VotingCore");
  const voting = await upgrades.deployProxy(Voting, [owner.address], { kind: "uups" });
  await voting.waitForDeployment();

  for (const account of [owner, proposer, ...voters]) {
    await (await token.mint(account.address, ethers.parseEther("100"))).wait();
  }

  const createSpaceTx = await voting.createSpace(await token.getAddress(), "Space", "Desc");
  const createSpaceReceipt = await createSpaceTx.wait();
  const spaceCreatedEvent = createSpaceReceipt.logs
    .map((l) => {
      try {
        return voting.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === "SpaceCreated");
  const spaceId = spaceCreatedEvent.args.spaceId;

  await (await voting.setProposer(spaceId, proposer.address, true)).wait();

  return { owner, proposer, voters, token, voting, spaceId };
}

async function createActiveProposal(voting, proposer, spaceId, optionsCount, allowMultipleChoices, titleSuffix) {
  const options = Array.from({ length: optionsCount }, (_, i) => `Option ${i + 1}`);
  const now = await time.latest();
  await (
    await voting
      .connect(proposer)
      .createProposal(
        spaceId,
        `Fuzz ${titleSuffix}`,
        "Invariant coverage",
        options,
        BigInt(now - 1),
        BigInt(now + 3600),
        allowMultipleChoices
      )
  ).wait();
}

describe("VotingCore fuzz/invariant", function () {
  it("preserves distribution invariant: sum(tallies) equals voter power on random payloads", async function () {
    const { voting, proposer, voters, spaceId } = await loadFixture(deployFixture);
    const rng = createSeededRng(0xA11CE);

    for (let i = 0; i < 30; i++) {
      const voter = voters[i % voters.length];
      const proposalId = i + 1;
      await createActiveProposal(voting, proposer, spaceId, 5, true, `dist-${i}`);

      const { optionIndices, weightsBps } = randomPayload(5, true, rng);
      const power = await voting.getVotingPower(spaceId, voter.address);
      await (await voting.connect(voter).vote(proposalId, optionIndices, weightsBps)).wait();

      const [, tallies] = await voting.getProposalTallies(proposalId);
      expect(sumBigInts(tallies)).to.equal(power);
    }
  });

  it("preserves recast invariant: final tallies match only latest payload", async function () {
    const { voting, proposer, voters, spaceId } = await loadFixture(deployFixture);
    const rng = createSeededRng(0xBEEF);

    for (let i = 0; i < 20; i++) {
      const voter = voters[i % voters.length];
      const proposalId = i + 1;
      await createActiveProposal(voting, proposer, spaceId, 4, true, `recast-${i}`);

      const firstPayload = randomPayload(4, true, rng);
      const secondPayload = randomPayload(4, true, rng);

      await (await voting.connect(voter).vote(proposalId, firstPayload.optionIndices, firstPayload.weightsBps)).wait();
      await (await voting.connect(voter).vote(proposalId, secondPayload.optionIndices, secondPayload.weightsBps)).wait();

      const power = await voting.getVotingPower(spaceId, voter.address);
      const expected = new Array(4).fill(0n);
      const distributed = computeDistributedWeights(power, secondPayload.weightsBps);
      for (let j = 0; j < secondPayload.optionIndices.length; j++) {
        expected[secondPayload.optionIndices[j]] += distributed[j];
      }

      const [, tallies] = await voting.getProposalTallies(proposalId);
      expect(tallies.map((x) => BigInt(x))).to.deep.equal(expected);
      expect(sumBigInts(tallies)).to.equal(power);
    }
  });

  it("preserves aggregate invariant: sum(tallies) equals sum(latest receipts.weight)", async function () {
    const { voting, proposer, voters, spaceId } = await loadFixture(deployFixture);
    const rng = createSeededRng(0xC0FFEE);
    const proposalId = 1;
    await createActiveProposal(voting, proposer, spaceId, 4, true, "aggregate");

    const touched = new Set();
    for (let step = 0; step < 60; step++) {
      const voter = voters[rng.nextInt(voters.length)];
      const payload = randomPayload(4, true, rng);
      await (await voting.connect(voter).vote(proposalId, payload.optionIndices, payload.weightsBps)).wait();
      touched.add(voter.address);

      if ((step + 1) % 10 === 0) {
        const [, tallies] = await voting.getProposalTallies(proposalId);
        let receiptWeightSum = 0n;
        for (const address of touched) {
          const receipt = await voting.getVoteReceipt(proposalId, address);
          if (receipt.hasVoted) {
            receiptWeightSum += BigInt(receipt.weight);
          }
        }
        expect(sumBigInts(tallies)).to.equal(receiptWeightSum);
      }
    }
  });

  it("enforces delegation ownership invariant and releases claim after sync+recast", async function () {
    const { voting, owner, proposer, voters, spaceId } = await loadFixture(deployFixture);
    const rng = createSeededRng(0xD1CE);

    const DelegateRegistry = await ethers.getContractFactory("DelegateRegistry");
    const delegateRegistry = await DelegateRegistry.deploy();
    await delegateRegistry.waitForDeployment();
    await (await voting.connect(owner).setDelegateRegistry(await delegateRegistry.getAddress())).wait();
    await (await voting.connect(owner).setSpaceDelegationId(spaceId, DELEGATION_ID)).wait();

    for (let i = 0; i < 4; i++) {
      const delegator = voters[(2 * i) % voters.length];
      const delegate = voters[(2 * i + 1) % voters.length];
      const claimProtectionProposalId = i * 2 + 1;
      const releaseProposalId = i * 2 + 2;

      await createActiveProposal(voting, proposer, spaceId, 3, true, `delegation-claim-${i}`);
      await createActiveProposal(voting, proposer, spaceId, 3, true, `delegation-release-${i}`);

      // Scenario A: already-claimed contributor cannot be claimed by another controller.
      const delegatorFirstVote = randomPayload(3, true, rng);
      await (
        await voting
          .connect(delegator)
          .vote(claimProtectionProposalId, delegatorFirstVote.optionIndices, delegatorFirstVote.weightsBps)
      ).wait();

      await (await delegateRegistry.connect(delegator).setDelegate(DELEGATION_ID, delegate.address)).wait();
      await (await voting.syncDelegationForSpace(spaceId, delegator.address)).wait();

      const delegateConflictVote = randomPayload(3, true, rng);
      await expect(
        voting
          .connect(delegate)
          .vote(claimProtectionProposalId, delegateConflictVote.optionIndices, delegateConflictVote.weightsBps)
      )
        .to.be.revertedWithCustomError(voting, "WeightAlreadyClaimed")
        .withArgs(delegator.address, delegator.address);

      // Scenario B: after delegation is cleared and delegate recasts, claim is released.
      const delegateInitialVote = randomPayload(3, true, rng);
      await (
        await voting
          .connect(delegate)
          .vote(releaseProposalId, delegateInitialVote.optionIndices, delegateInitialVote.weightsBps)
      ).wait();

      await (await delegateRegistry.connect(delegator).clearDelegate(DELEGATION_ID)).wait();
      await (await voting.syncDelegationForSpace(spaceId, delegator.address)).wait();

      const delegateRecast = randomPayload(3, true, rng);
      await (
        await voting.connect(delegate).vote(releaseProposalId, delegateRecast.optionIndices, delegateRecast.weightsBps)
      ).wait();

      const freedPayload = randomPayload(3, true, rng);
      await expect(
        voting.connect(delegator).vote(releaseProposalId, freedPayload.optionIndices, freedPayload.weightsBps)
      ).to.not.be.reverted;
    }
  });
});
