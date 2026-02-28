import { mapEventToText, type EventLikeLog } from "./eventText";
import type {
  ProposalViewModel,
  SpaceView,
  TalliesView,
  VotingAction,
  VotingService,
  VotingTxResult,
  WalletAddress
} from "./votingService";
import type { ProposalVoterView } from "./realVotingViews";

type VoteReceipt = {
  hasVoted: boolean;
  optionIndices: number[];
  weightsBps: number[];
  weight: bigint;
  updatedAt: bigint;
};

type DelegationSyncPeriod = {
  fromTs: bigint;
  toTs: bigint;
};

const MOCK_ACCOUNTS: WalletAddress[] = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
];

class InMemoryVotingService implements VotingService {
  private readonly chainId: number;
  private readonly spaces = new Map<bigint, SpaceView>();
  private readonly admins = new Map<bigint, Set<WalletAddress>>();
  private readonly proposers = new Map<bigint, Set<WalletAddress>>();
  private readonly proposals = new Map<bigint, ProposalViewModel>();
  private readonly tallies = new Map<bigint, bigint[]>();
  private readonly receipts = new Map<bigint, Map<WalletAddress, VoteReceipt>>();
  private readonly balances = new Map<WalletAddress, bigint>();
  private readonly delegatesBySpace = new Map<bigint, Map<WalletAddress, WalletAddress>>();
  private readonly delegationSyncPeriods = new Map<bigint, DelegationSyncPeriod>();
  private readonly listeners = new Set<() => void>();
  private readonly activity: string[] = [];

  private nextSpaceId = 1n;
  private nextProposalId = 1n;
  private nextTxId = 1n;
  private connectedAddress: WalletAddress | null = null;

  constructor(chainId: number) {
    this.chainId = chainId;
    for (const account of MOCK_ACCOUNTS) {
      this.balances.set(account, 100000000000000000000n);
    }
  }

  getChainId(): number {
    return this.chainId;
  }

  getConnectedAddress(): WalletAddress | null {
    return this.connectedAddress;
  }

  getAccounts(): WalletAddress[] {
    return [...MOCK_ACCOUNTS];
  }

  connect(address: WalletAddress): void {
    if (!this.balances.has(address)) {
      this.balances.set(address, 0n);
    }
    this.connectedAddress = address;
    this.emit();
  }

  disconnect(): void {
    this.connectedAddress = null;
    this.emit();
  }

  getSpace(spaceId: bigint): SpaceView | null {
    return this.spaces.get(spaceId) ?? null;
  }

  getProposal(proposalId: bigint): ProposalViewModel | null {
    return this.proposals.get(proposalId) ?? null;
  }

  getProposalTallies(proposalId: bigint): TalliesView | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;
    return {
      options: [...proposal.options],
      tallies: [...(this.tallies.get(proposalId) ?? proposal.options.map(() => 0n))]
    };
  }

  isAdmin(spaceId: bigint, account: WalletAddress): boolean {
    return this.admins.get(spaceId)?.has(account) ?? false;
  }

  listAdmins(spaceId: bigint): WalletAddress[] {
    const admins = this.admins.get(spaceId);
    if (!admins) return [];
    return [...admins].sort((a, b) => a.localeCompare(b));
  }

  isProposer(spaceId: bigint, account: WalletAddress): boolean {
    const space = this.spaces.get(spaceId);
    if (!space) return false;
    return account === space.owner || (this.proposers.get(spaceId)?.has(account) ?? false);
  }

  getActiveProposalIds(): bigint[] {
    return [...this.proposals.values()]
      .filter((proposal) => !proposal.deleted)
      .map((proposal) => proposal.id)
      .sort((a, b) => Number(a - b));
  }

  getActivityFeed(): string[] {
    return [...this.activity];
  }

  listSpaces(): SpaceView[] {
    return [...this.spaces.values()].sort((a, b) => Number(b.id - a.id));
  }

  listProposalsBySpace(spaceId: bigint): ProposalViewModel[] {
    return [...this.proposals.values()]
      .filter((proposal) => proposal.spaceId === spaceId && !proposal.deleted)
      .sort((a, b) => Number(b.id - a.id));
  }

  listVotersForProposal(proposalId: bigint): ProposalVoterView[] {
    const receipts = this.receipts.get(proposalId);
    if (!receipts) return [];
    return [...receipts.entries()]
      .map(([voter, receipt]) => ({
        voter,
        optionIndices: [...receipt.optionIndices],
        weightsBps: [...receipt.weightsBps],
        weight: receipt.weight,
        updatedAt: receipt.updatedAt
      }))
      .sort((a, b) => b.voter.localeCompare(a.voter));
  }

  getVotingPower(spaceId: bigint, voter: WalletAddress): bigint {
    const space = this.spaces.get(spaceId);
    if (!space) return 0n;
    const delegates = this.delegatesBySpace.get(spaceId) ?? new Map<WalletAddress, WalletAddress>();
    let total = delegates.get(voter) ? 0n : (this.balances.get(voter) ?? 0n);
    for (const [delegator, delegate] of delegates.entries()) {
      if (delegate === voter) {
        total += this.balances.get(delegator) ?? 0n;
      }
    }
    return total;
  }

  getSpaceDelegationSyncPeriod(spaceId: bigint): DelegationSyncPeriod {
    return this.delegationSyncPeriods.get(spaceId) ?? { fromTs: 0n, toTs: 0n };
  }

  async execute(action: VotingAction): Promise<VotingTxResult> {
    const from = this.connectedAddress;
    if (!from) throw new Error("Unauthorized");

    const logs: EventLikeLog[] = [];
    const now = BigInt(Math.floor(Date.now() / 1000));

    if (action.functionName === "createSpace") {
      const [token, name, description] = action.args;
      const spaceId = this.nextSpaceId++;
      const space: SpaceView = {
        id: spaceId,
        token,
        owner: from,
        name,
        description,
        delegationId: "0x0000000000000000000000000000000000000000000000000000000000000000"
      };
      this.spaces.set(spaceId, space);
      const proposers = this.proposers.get(spaceId) ?? new Set<WalletAddress>();
      proposers.add(from);
      this.proposers.set(spaceId, proposers);
      logs.push({ eventName: "SpaceCreated", args: { spaceId, owner: from, token, name } });
    } else if (action.functionName === "setAdmin") {
      const [spaceId, account, allowed] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (space.owner !== from) throw new Error("Unauthorized");
      const admins = this.admins.get(spaceId) ?? new Set<WalletAddress>();
      if (allowed) admins.add(account);
      else admins.delete(account);
      this.admins.set(spaceId, admins);
      logs.push({ eventName: "SpaceAdminUpdated", args: { spaceId, account, allowed } });
    } else if (action.functionName === "setSpaceDelegationId") {
      const [spaceId, delegationId] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (space.owner !== from && !this.isAdmin(spaceId, from)) throw new Error("Unauthorized");
      if (
        space.delegationId !== "0x0000000000000000000000000000000000000000000000000000000000000000" &&
        space.delegationId !== delegationId
      ) {
        throw new Error("DelegationIdAlreadySet");
      }
      space.delegationId = delegationId;
      logs.push({ eventName: "SpaceDelegationIdUpdated", args: { spaceId, delegationId, updater: from } });
    } else if (action.functionName === "setProposer") {
      const [spaceId, account, allowed] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (space.owner !== from && !this.isAdmin(spaceId, from)) throw new Error("Unauthorized");
      const proposers = this.proposers.get(spaceId) ?? new Set<WalletAddress>();
      if (allowed) proposers.add(account);
      else proposers.delete(account);
      this.proposers.set(spaceId, proposers);
      logs.push({ eventName: "SpaceProposerUpdated", args: { spaceId, account, allowed } });
    } else if (action.functionName === "setDelegateForSpace") {
      const [spaceId, delegate] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (space.delegationId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        throw new Error("DelegationIdNotSet");
      }
      if (delegate === from) throw new Error("Can't delegate to self");
      if (delegate === "0x0000000000000000000000000000000000000000") throw new Error("Can't delegate to 0x0");
      const delegates = this.delegatesBySpace.get(spaceId) ?? new Map<WalletAddress, WalletAddress>();
      if (delegates.get(from) === delegate) throw new Error("Already delegated to this address");
      delegates.set(from, delegate);
      this.delegatesBySpace.set(spaceId, delegates);
      logs.push({ eventName: "SpaceDelegateSet", args: { spaceId, delegationId: space.delegationId, delegator: from, delegate } });
    } else if (action.functionName === "clearDelegateForSpace") {
      const [spaceId] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (space.delegationId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        throw new Error("DelegationIdNotSet");
      }
      const delegates = this.delegatesBySpace.get(spaceId) ?? new Map<WalletAddress, WalletAddress>();
      const previous = delegates.get(from);
      if (!previous) throw new Error("No delegate set");
      delegates.delete(from);
      this.delegatesBySpace.set(spaceId, delegates);
      logs.push({
        eventName: "SpaceDelegateCleared",
        args: { spaceId, delegationId: space.delegationId, delegator: from, delegate: previous }
      });
    } else if (action.functionName === "syncDelegationsForSpace") {
      const [spaceId] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (space.delegationId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        throw new Error("DelegationIdNotSet");
      }
    } else if (action.functionName === "setSpaceDelegationSyncPeriod") {
      const [spaceId, fromTs, toTs] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (space.owner !== from) throw new Error("Unauthorized");
      if (fromTs > toTs) throw new Error("InvalidSyncPeriod");
      const current = this.delegationSyncPeriods.get(spaceId);
      if (current && (fromTs < current.fromTs || toTs < current.toTs)) {
        throw new Error("InvalidSyncPeriod");
      }
      this.delegationSyncPeriods.set(spaceId, { fromTs, toTs });
      logs.push({
        eventName: "SpaceDelegationSyncPeriodUpdated",
        args: { spaceId, updater: from, fromTs, toTs }
      });
    } else if (action.functionName === "createProposal") {
      const [spaceId, title, description, options, startAt, endAt, allowMultipleChoices] = action.args;
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error("SpaceNotFound");
      if (!this.isProposer(spaceId, from)) throw new Error("Unauthorized");
      if (options.length < 2) throw new Error("InvalidOption");
      if (startAt >= endAt) throw new Error("InvalidTimeRange");

      const proposalId = this.nextProposalId++;
      const proposal: ProposalViewModel = {
        id: proposalId,
        spaceId,
        author: from,
        title,
        description,
        options: [...options],
        startAt,
        endAt,
        deleted: false,
        totalVotesCast: 0n,
        allowMultipleChoices
      };
      this.proposals.set(proposalId, proposal);
      this.tallies.set(proposalId, options.map(() => 0n));
      logs.push({
        eventName: "ProposalCreated",
        args: { proposalId, spaceId, author: from, startAt, endAt, allowMultipleChoices }
      });
    } else if (action.functionName === "deleteProposal") {
      const [proposalId] = action.args;
      const proposal = this.proposals.get(proposalId);
      if (!proposal) throw new Error("ProposalNotFound");
      if (proposal.author !== from) throw new Error("Unauthorized");
      if (proposal.deleted) throw new Error("AlreadyDeleted");
      proposal.deleted = true;
      logs.push({ eventName: "ProposalDeleted", args: { proposalId, author: from } });
    } else if (action.functionName === "vote") {
      const [proposalId, optionIndices, weightsBps] = action.args;
      const proposal = this.proposals.get(proposalId);
      if (!proposal) throw new Error("ProposalNotFound");
      if (proposal.deleted) throw new Error("ProposalIsDeleted");
      if (now < proposal.startAt) throw new Error("ProposalNotStarted");
      if (now >= proposal.endAt) throw new Error("ProposalEnded");
      if (optionIndices.length === 0 || optionIndices.length !== weightsBps.length) throw new Error("InvalidVoteSplit");
      if (!proposal.allowMultipleChoices && optionIndices.length !== 1) throw new Error("MultiSelectNotAllowed");

      const weight = this.getVotingPower(proposal.spaceId, from);
      if (weight === 0n) throw new Error("NoVotingPower");

      const seen = new Set<number>();
      let bpsTotal = 0;
      for (let i = 0; i < optionIndices.length; i += 1) {
        const optionIndex = optionIndices[i];
        const bps = weightsBps[i];
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= proposal.options.length) {
          throw new Error("InvalidOption");
        }
        if (!Number.isInteger(bps) || bps <= 0) throw new Error("InvalidVoteSplit");
        if (seen.has(optionIndex)) throw new Error("DuplicateOption");
        seen.add(optionIndex);
        bpsTotal += bps;
      }
      if (bpsTotal !== 10000) throw new Error("InvalidVoteSplit");

      const distributedWeights: bigint[] = [];
      let allocated = 0n;
      for (let i = 0; i < optionIndices.length; i += 1) {
        const portion = i === optionIndices.length - 1 ? weight - allocated : (weight * BigInt(weightsBps[i])) / 10000n;
        distributedWeights.push(portion);
        allocated += portion;
      }

      const tallies = this.tallies.get(proposalId) ?? proposal.options.map(() => 0n);
      const receipts = this.receipts.get(proposalId) ?? new Map<WalletAddress, VoteReceipt>();
      const receipt = receipts.get(from);

      if (receipt?.hasVoted) {
        const previousDistributed = this.splitWeightByBps(receipt.weight, receipt.weightsBps);
        for (let i = 0; i < receipt.optionIndices.length; i += 1) {
          const oldOption = receipt.optionIndices[i];
          tallies[oldOption] = tallies[oldOption] - previousDistributed[i];
        }
        for (let i = 0; i < optionIndices.length; i += 1) {
          tallies[optionIndices[i]] = tallies[optionIndices[i]] + distributedWeights[i];
        }
        logs.push({
          eventName: "VoteRecast",
          args: {
            proposalId,
            voter: from,
            oldTotalWeight: receipt.weight,
            optionIndices: [...optionIndices],
            weightsBps: [...weightsBps],
            distributedWeights: [...distributedWeights],
            newTotalWeight: weight
          }
        });
      } else {
        for (let i = 0; i < optionIndices.length; i += 1) {
          tallies[optionIndices[i]] = tallies[optionIndices[i]] + distributedWeights[i];
        }
        logs.push({
          eventName: "VoteCast",
          args: {
            proposalId,
            voter: from,
            optionIndices: [...optionIndices],
            weightsBps: [...weightsBps],
            distributedWeights: [...distributedWeights],
            totalWeight: weight
          }
        });
      }

      receipts.set(from, {
        hasVoted: true,
        optionIndices: [...optionIndices],
        weightsBps: [...weightsBps],
        weight,
        updatedAt: now
      });
      this.receipts.set(proposalId, receipts);
      this.tallies.set(proposalId, tallies);
      proposal.totalVotesCast += 1n;
    }

    for (const log of logs) {
      const line = mapEventToText(log);
      if (line) this.activity.unshift(line);
    }
    this.activity.splice(200);
    this.emit();

    const hash = `0x${this.nextTxId.toString(16).padStart(64, "0")}` as `0x${string}`;
    this.nextTxId += 1n;
    return { hash, logs };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private splitWeightByBps(totalWeight: bigint, weightsBps: number[]): bigint[] {
    const result: bigint[] = [];
    let allocated = 0n;
    for (let i = 0; i < weightsBps.length; i += 1) {
      const portion = i === weightsBps.length - 1 ? totalWeight - allocated : (totalWeight * BigInt(weightsBps[i])) / 10000n;
      result.push(portion);
      allocated += portion;
    }
    return result;
  }
}

let singleton: InMemoryVotingService | null = null;

export type MockVotingViews = {
  listSpaces(): SpaceView[];
  listProposalsBySpace(spaceId: bigint): ProposalViewModel[];
  listVotersForProposal(proposalId: bigint): ProposalVoterView[];
  getVotingPower(spaceId: bigint, voter: WalletAddress): bigint;
  getSpaceDelegationSyncPeriod(spaceId: bigint): { fromTs: bigint; toTs: bigint };
};

export function getMockVotingService(chainId: number): VotingService {
  if (!singleton) singleton = new InMemoryVotingService(chainId);
  return singleton;
}
