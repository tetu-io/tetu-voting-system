import { parseAbiItem, type PublicClient } from "viem";
import type { EventLikeLog } from "./eventText";
import type { ProposalViewModel, SpaceView, WalletAddress } from "./votingService";

export type ProposalVoterView = {
  voter: WalletAddress;
  optionIndices: number[];
  weightsBps: number[];
  weight: bigint;
  updatedAt: bigint | null;
};

export type PagedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const readSpaceAbi = parseAbiItem(
  "function getSpace(uint256 spaceId) view returns ((uint256 id, address token, address owner, string name, string description, bytes32 delegationId))"
);
const readProposalAbi = parseAbiItem(
  "function getProposal(uint256 proposalId) view returns ((uint256 id, uint256 spaceId, address author, string title, string description, string[] options, uint64 startAt, uint64 endAt, bool deleted, uint256 totalVotesCast, bool allowMultipleChoices))"
);

export async function fetchRealActivityLogs(
  logsClient: PublicClient,
  address: `0x${string}`
): Promise<EventLikeLog[]> {
  const [spaceCreated, spaceAdmins, spaceProposers, proposalCreated, proposalDeletedLogs, voteCast, voteRecast] =
    await Promise.all([
      logsClient.getLogs({
        address,
        event: parseAbiItem(
          "event SpaceCreated(uint256 indexed spaceId, address indexed owner, address indexed token, string name)"
        ),
        fromBlock: 0n,
        toBlock: "latest"
      }),
      logsClient.getLogs({
        address,
        event: parseAbiItem("event SpaceAdminUpdated(uint256 indexed spaceId, address indexed account, bool allowed)"),
        fromBlock: 0n,
        toBlock: "latest"
      }),
      logsClient.getLogs({
        address,
        event: parseAbiItem(
          "event SpaceProposerUpdated(uint256 indexed spaceId, address indexed account, bool allowed)"
        ),
        fromBlock: 0n,
        toBlock: "latest"
      }),
      logsClient.getLogs({
        address,
        event: parseAbiItem(
          "event ProposalCreated(uint256 indexed proposalId, uint256 indexed spaceId, address indexed author, uint64 startAt, uint64 endAt, bool allowMultipleChoices)"
        ),
        fromBlock: 0n,
        toBlock: "latest"
      }),
      logsClient.getLogs({
        address,
        event: parseAbiItem("event ProposalDeleted(uint256 indexed proposalId, address indexed author)"),
        fromBlock: 0n,
        toBlock: "latest"
      }),
      logsClient.getLogs({
        address,
        event: parseAbiItem(
          "event VoteCast(uint256 indexed proposalId, address indexed voter, uint16[] optionIndices, uint16[] weightsBps, uint256[] distributedWeights, uint256 totalWeight)"
        ),
        fromBlock: 0n,
        toBlock: "latest"
      }),
      logsClient.getLogs({
        address,
        event: parseAbiItem(
          "event VoteRecast(uint256 indexed proposalId, address indexed voter, uint256 oldTotalWeight, uint16[] optionIndices, uint16[] weightsBps, uint256[] distributedWeights, uint256 newTotalWeight)"
        ),
        fromBlock: 0n,
        toBlock: "latest"
      })
    ]);

  const allLogs = [
    ...spaceCreated,
    ...spaceAdmins,
    ...spaceProposers,
    ...proposalCreated,
    ...proposalDeletedLogs,
    ...voteCast,
    ...voteRecast
  ] as EventLikeLog[];
  allLogs.sort((a, b) => {
    const byBlock = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
    if (byBlock !== 0) return byBlock;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });
  return allLogs;
}

export async function fetchRealActiveProposalIds(
  logsClient: PublicClient,
  address: `0x${string}`
): Promise<bigint[]> {
  const [createdLogs, deletedLogs] = await Promise.all([
    logsClient.getLogs({
      address,
      event: parseAbiItem(
        "event ProposalCreated(uint256 indexed proposalId, uint256 indexed spaceId, address indexed author, uint64 startAt, uint64 endAt, bool allowMultipleChoices)"
      ),
      fromBlock: 0n,
      toBlock: "latest"
    }),
    logsClient.getLogs({
      address,
      event: parseAbiItem("event ProposalDeleted(uint256 indexed proposalId, address indexed author)"),
      fromBlock: 0n,
      toBlock: "latest"
    })
  ]);

  const createdIds = createdLogs
    .map((log) => (log.args as { proposalId?: bigint }).proposalId)
    .filter((id): id is bigint => typeof id === "bigint");
  const deletedIds = new Set(
    deletedLogs
      .map((log) => (log.args as { proposalId?: bigint }).proposalId)
      .filter((id): id is bigint => typeof id === "bigint")
  );
  return createdIds.filter((id) => !deletedIds.has(id));
}

export async function fetchRealSpaceIds(logsClient: PublicClient, address: `0x${string}`): Promise<bigint[]> {
  const logs = await logsClient.getLogs({
    address,
    event: parseAbiItem("event SpaceCreated(uint256 indexed spaceId, address indexed owner, address indexed token, string name)"),
    fromBlock: 0n,
    toBlock: "latest"
  });
  const ids = logs
    .map((log) => (log.args as { spaceId?: bigint }).spaceId)
    .filter((id): id is bigint => typeof id === "bigint");
  return [...new Set(ids.map((id) => id.toString()))].map((id) => BigInt(id)).sort((a, b) => Number(a - b));
}

export async function fetchRealSpaces(client: PublicClient, address: `0x${string}`, logsClient: PublicClient = client): Promise<SpaceView[]> {
  const ids = await fetchRealSpaceIds(logsClient, address);
  const spaces = await Promise.all(
    ids.map(async (spaceId) => {
      try {
        const raw = await client.readContract({
          address,
          abi: [readSpaceAbi],
          functionName: "getSpace",
          args: [spaceId]
        });
        return {
          id: raw.id,
          token: raw.token as WalletAddress,
          owner: raw.owner as WalletAddress,
          name: raw.name,
          description: raw.description,
          delegationId: raw.delegationId as `0x${string}`
        } satisfies SpaceView;
      } catch {
        return null;
      }
    })
  );
  return spaces.filter((item): item is SpaceView => item !== null);
}

export async function fetchRealProposalsBySpace(
  client: PublicClient,
  address: `0x${string}`,
  spaceId: bigint,
  logsClient: PublicClient = client
): Promise<ProposalViewModel[]> {
  const [createdLogs, deletedLogs] = await Promise.all([
    logsClient.getLogs({
      address,
      event: parseAbiItem(
        "event ProposalCreated(uint256 indexed proposalId, uint256 indexed spaceId, address indexed author, uint64 startAt, uint64 endAt, bool allowMultipleChoices)"
      ),
      args: { spaceId },
      fromBlock: 0n,
      toBlock: "latest"
    }),
    logsClient.getLogs({
      address,
      event: parseAbiItem("event ProposalDeleted(uint256 indexed proposalId, address indexed author)"),
      fromBlock: 0n,
      toBlock: "latest"
    })
  ]);
  const deleted = new Set(
    deletedLogs
      .map((log) => (log.args as { proposalId?: bigint }).proposalId)
      .filter((id): id is bigint => typeof id === "bigint")
      .map((id) => id.toString())
  );

  const ids = createdLogs
    .map((log) => (log.args as { proposalId?: bigint }).proposalId)
    .filter((id): id is bigint => typeof id === "bigint")
    .filter((id) => !deleted.has(id.toString()));

  const proposals = await Promise.all(
    ids.map(async (proposalId) => {
      try {
        const raw = await client.readContract({
          address,
          abi: [readProposalAbi],
          functionName: "getProposal",
          args: [proposalId]
        });
        return {
          id: raw.id,
          spaceId: raw.spaceId,
          author: raw.author as WalletAddress,
          title: raw.title,
          description: raw.description,
          options: [...raw.options],
          startAt: raw.startAt,
          endAt: raw.endAt,
          deleted: raw.deleted,
          totalVotesCast: raw.totalVotesCast,
          allowMultipleChoices: raw.allowMultipleChoices
        } satisfies ProposalViewModel;
      } catch {
        return null;
      }
    })
  );

  return proposals
    .filter((item): item is ProposalViewModel => item !== null)
    .sort((a, b) => Number(b.id - a.id));
}

export async function fetchRealProposalVoters(
  client: PublicClient,
  address: `0x${string}`,
  proposalId: bigint,
  logsClient: PublicClient = client
): Promise<ProposalVoterView[]> {
  const [voteCastLogs, voteRecastLogs] = await Promise.all([
    logsClient.getLogs({
      address,
      event: parseAbiItem(
        "event VoteCast(uint256 indexed proposalId, address indexed voter, uint16[] optionIndices, uint16[] weightsBps, uint256[] distributedWeights, uint256 totalWeight)"
      ),
      args: { proposalId },
      fromBlock: 0n,
      toBlock: "latest"
    }),
    logsClient.getLogs({
      address,
      event: parseAbiItem(
        "event VoteRecast(uint256 indexed proposalId, address indexed voter, uint256 oldTotalWeight, uint16[] optionIndices, uint16[] weightsBps, uint256[] distributedWeights, uint256 newTotalWeight)"
      ),
      args: { proposalId },
      fromBlock: 0n,
      toBlock: "latest"
    })
  ]);

  const ordered = [...voteCastLogs, ...voteRecastLogs].sort((a, b) => {
    const byBlock = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
    if (byBlock !== 0) return byBlock;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  const uniqueBlockNumbers = [...new Set(ordered.map((log) => log.blockNumber).filter((item): item is bigint => typeof item === "bigint"))];
  const blocks = await Promise.all(
    uniqueBlockNumbers.map(async (blockNumber) => ({
      blockNumber,
      block: await logsClient.getBlock({ blockNumber })
    }))
  );
  const blockTimestampByNumber = new Map<bigint, bigint>(blocks.map(({ blockNumber, block }) => [blockNumber, block.timestamp]));

  const voterState = new Map<WalletAddress, ProposalVoterView>();
  for (const log of ordered) {
    const args = log.args as Record<string, unknown>;
    const voter = args.voter;
    if (typeof voter !== "string") continue;
    const updatedAt = typeof log.blockNumber === "bigint" ? (blockTimestampByNumber.get(log.blockNumber) ?? null) : null;
    if (log.eventName === "VoteCast") {
      const optionIndices = (args.optionIndices as readonly bigint[] | undefined) ?? [];
      const weightsBps = (args.weightsBps as readonly bigint[] | undefined) ?? [];
      voterState.set(voter as WalletAddress, {
        voter: voter as WalletAddress,
        optionIndices: optionIndices.map((item) => Number(item)),
        weightsBps: weightsBps.map((item) => Number(item)),
        weight: (args.totalWeight as bigint) ?? 0n,
        updatedAt
      });
      continue;
    }
    const newOptionIndices = (args.optionIndices as readonly bigint[] | undefined) ?? [];
    const newWeightsBps = (args.weightsBps as readonly bigint[] | undefined) ?? [];
    voterState.set(voter as WalletAddress, {
      voter: voter as WalletAddress,
      optionIndices: newOptionIndices.map((item) => Number(item)),
      weightsBps: newWeightsBps.map((item) => Number(item)),
      weight: (args.newTotalWeight as bigint) ?? 0n,
      updatedAt
    });
  }
  return [...voterState.values()].sort((a, b) => b.voter.localeCompare(a.voter));
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): PagedResult<T> {
  const safePageSize = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages
  };
}
