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
const getSpaceIdsCountAbi = parseAbiItem("function getSpaceIdsCount() view returns (uint256)");
const getSpaceIdsPageAbi = parseAbiItem("function getSpaceIdsPage(uint256 offset, uint256 limit) view returns (uint256[])");
const getProposalIdsBySpaceCountAbi = parseAbiItem("function getProposalIdsBySpaceCount(uint256 spaceId, bool includeDeleted) view returns (uint256)");
const getProposalIdsBySpacePageAbi =
  parseAbiItem("function getProposalIdsBySpacePage(uint256 spaceId, uint256 offset, uint256 limit, bool includeDeleted) view returns (uint256[])");
const getProposalVotersCountAbi = parseAbiItem("function getProposalVotersCount(uint256 proposalId) view returns (uint256)");
const getProposalVotersPageAbi = parseAbiItem("function getProposalVotersPage(uint256 proposalId, uint256 offset, uint256 limit) view returns (address[])");
const getVoteReceiptAbi = parseAbiItem(
  "function getVoteReceipt(uint256 proposalId, address voter) view returns ((bool hasVoted, uint16 optionIndex, uint256 weight, uint64 updatedAt, uint16[] optionIndices, uint16[] weightsBps, address[] contributors))"
);
const PAGE_CHUNK = 100n;

async function readUintIdsPage(
  client: PublicClient,
  address: `0x${string}`,
  countAbi: typeof getSpaceIdsCountAbi | typeof getProposalIdsBySpaceCountAbi,
  pageAbi: typeof getSpaceIdsPageAbi | typeof getProposalIdsBySpacePageAbi,
  countArgs: readonly unknown[],
  pageArgsBuilder: (offset: bigint, limit: bigint) => readonly unknown[]
): Promise<bigint[]> {
  const total = (await client.readContract({
    address,
    abi: [countAbi],
    functionName: countAbi.name,
    args: countArgs
  })) as bigint;
  if (total === 0n) return [];
  const ids: bigint[] = [];
  for (let offset = 0n; offset < total; offset += PAGE_CHUNK) {
    const remaining = total - offset;
    const limit = remaining < PAGE_CHUNK ? remaining : PAGE_CHUNK;
    const page = (await client.readContract({
      address,
      abi: [pageAbi],
      functionName: pageAbi.name,
      args: pageArgsBuilder(offset, limit)
    })) as bigint[];
    ids.push(...page);
  }
  return ids;
}

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
  client: PublicClient,
  address: `0x${string}`
): Promise<bigint[]> {
  const spaceIds = await fetchRealSpaceIds(client, address);
  const proposalIdChunks = await Promise.all(
    spaceIds.map((spaceId) =>
      readUintIdsPage(client, address, getProposalIdsBySpaceCountAbi, getProposalIdsBySpacePageAbi, [spaceId, false], (offset, limit) => [
        spaceId,
        offset,
        limit,
        false
      ])
    )
  );
  return proposalIdChunks.flat().sort((a, b) => Number(a - b));
}

export async function fetchRealSpaceIds(client: PublicClient, address: `0x${string}`): Promise<bigint[]> {
  return readUintIdsPage(client, address, getSpaceIdsCountAbi, getSpaceIdsPageAbi, [], (offset, limit) => [offset, limit]);
}

export async function fetchRealSpaces(client: PublicClient, address: `0x${string}`, _logsClient: PublicClient = client): Promise<SpaceView[]> {
  void _logsClient;
  const ids = await fetchRealSpaceIds(client, address);
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
  _logsClient: PublicClient = client
): Promise<ProposalViewModel[]> {
  void _logsClient;
  const ids = await readUintIdsPage(
    client,
    address,
    getProposalIdsBySpaceCountAbi,
    getProposalIdsBySpacePageAbi,
    [spaceId, false],
    (offset, limit) => [spaceId, offset, limit, false]
  );

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
  _logsClient: PublicClient = client
): Promise<ProposalVoterView[]> {
  void _logsClient;
  const total = (await client.readContract({
    address,
    abi: [getProposalVotersCountAbi],
    functionName: "getProposalVotersCount",
    args: [proposalId]
  })) as bigint;
  if (total === 0n) return [];

  const voters: WalletAddress[] = [];
  for (let offset = 0n; offset < total; offset += PAGE_CHUNK) {
    const remaining = total - offset;
    const limit = remaining < PAGE_CHUNK ? remaining : PAGE_CHUNK;
    const page = (await client.readContract({
      address,
      abi: [getProposalVotersPageAbi],
      functionName: "getProposalVotersPage",
      args: [proposalId, offset, limit]
    })) as WalletAddress[];
    voters.push(...page);
  }

  const voterViews = await Promise.all(
    voters.map(async (voter) => {
      const receipt = (await client.readContract({
        address,
        abi: [getVoteReceiptAbi],
        functionName: "getVoteReceipt",
        args: [proposalId, voter]
      })) as {
        hasVoted: boolean;
        optionIndices: readonly bigint[];
        weightsBps: readonly bigint[];
        weight: bigint;
        updatedAt: bigint;
      };
      return {
        voter,
        optionIndices: receipt.optionIndices.map((item) => Number(item)),
        weightsBps: receipt.weightsBps.map((item) => Number(item)),
        weight: receipt.weight,
        updatedAt: receipt.hasVoted ? receipt.updatedAt : null
      } satisfies ProposalVoterView;
    })
  );

  return voterViews.sort((a, b) => b.voter.localeCompare(a.voter));
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
