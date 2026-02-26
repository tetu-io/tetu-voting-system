import type { EventLikeLog } from "./eventText";

export type WalletAddress = `0x${string}`;

export type SpaceView = {
  id: bigint;
  token: WalletAddress;
  owner: WalletAddress;
  name: string;
  description: string;
  delegationId: `0x${string}`;
};

export type ProposalViewModel = {
  id: bigint;
  spaceId: bigint;
  author: WalletAddress;
  title: string;
  description: string;
  options: string[];
  startAt: bigint;
  endAt: bigint;
  deleted: boolean;
  totalVotesCast: bigint;
  allowMultipleChoices: boolean;
};

export type TalliesView = {
  options: string[];
  tallies: bigint[];
};

export type VotingAction =
  | { functionName: "createSpace"; args: [WalletAddress, string, string] }
  | { functionName: "setAdmin"; args: [bigint, WalletAddress, boolean] }
  | { functionName: "setProposer"; args: [bigint, WalletAddress, boolean] }
  | { functionName: "setSpaceDelegationId"; args: [bigint, `0x${string}`] }
  | { functionName: "setDelegateForSpace"; args: [bigint, WalletAddress] }
  | { functionName: "clearDelegateForSpace"; args: [bigint] }
  | { functionName: "syncDelegationsForSpace"; args: [bigint, WalletAddress[]] }
  | { functionName: "createProposal"; args: [bigint, string, string, string[], bigint, bigint, boolean] }
  | { functionName: "deleteProposal"; args: [bigint] }
  | { functionName: "vote"; args: [bigint, number[], number[]] };

export type VotingTxResult = {
  hash: `0x${string}`;
  logs: EventLikeLog[];
};

export interface VotingService {
  getChainId(): number;
  getConnectedAddress(): WalletAddress | null;
  getAccounts(): WalletAddress[];
  connect(address: WalletAddress): void;
  disconnect(): void;

  getSpace(spaceId: bigint): SpaceView | null;
  getProposal(proposalId: bigint): ProposalViewModel | null;
  getProposalTallies(proposalId: bigint): TalliesView | null;
  isAdmin(spaceId: bigint, account: WalletAddress): boolean;
  isProposer(spaceId: bigint, account: WalletAddress): boolean;
  getActiveProposalIds(): bigint[];
  getActivityFeed(): string[];

  execute(action: VotingAction): Promise<VotingTxResult>;
  subscribe(listener: () => void): () => void;
}
