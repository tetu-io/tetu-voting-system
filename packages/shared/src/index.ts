export type ProposalView = {
  id: bigint;
  spaceId: bigint;
  author: string;
  title: string;
  description: string;
  options: string[];
  startAt: bigint;
  endAt: bigint;
  deleted: boolean;
  totalVotesCast: bigint;
};

export type ProposalTalliesView = {
  options: string[];
  tallies: bigint[];
};
