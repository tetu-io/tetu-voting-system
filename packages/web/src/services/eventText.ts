export type ActivityItem = {
  key: string;
  text: string;
};

export type EventLikeLog = {
  eventName?: string;
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  logIndex?: number;
};

export function mapEventToText(log: EventLikeLog): string | null {
  const args = log.args ?? {};
  if (log.eventName === "SpaceCreated") return `SpaceCreated #${String(args.spaceId)}`;
  if (log.eventName === "SpaceAdminUpdated")
    return `SpaceAdminUpdated #${String(args.spaceId)} ${String(args.account)}=${String(args.allowed)}`;
  if (log.eventName === "SpaceProposerUpdated")
    return `SpaceProposerUpdated #${String(args.spaceId)} ${String(args.account)}=${String(args.allowed)}`;
  if (log.eventName === "SpaceDelegationIdUpdated")
    return `SpaceDelegationIdUpdated #${String(args.spaceId)}`;
  if (log.eventName === "SpaceDelegateSet")
    return `SpaceDelegateSet #${String(args.spaceId)} ${String(args.delegator)}=>${String(args.delegate)}`;
  if (log.eventName === "SpaceDelegateCleared")
    return `SpaceDelegateCleared #${String(args.spaceId)} ${String(args.delegator)}`;
  if (log.eventName === "ProposalCreated")
    return `ProposalCreated #${String(args.proposalId)} (space ${String(args.spaceId)})`;
  if (log.eventName === "ProposalDeleted") return `ProposalDeleted #${String(args.proposalId)}`;
  if (log.eventName === "VoteCast")
    return `VoteCast proposal=${String(args.proposalId)} options=${String(args.optionIndices)}`;
  if (log.eventName === "VoteRecast")
    return `VoteRecast proposal=${String(args.proposalId)} options=${String(args.optionIndices)}`;
  return null;
}

export function normalizeError(error: unknown): string {
  const raw = String(error);
  if (raw.includes("User rejected")) return "User rejected transaction";
  if (raw.includes("ProposalEnded")) return "Proposal ended";
  if (raw.includes("ProposalNotStarted")) return "Proposal not started";
  if (raw.includes("ProposalIsDeleted")) return "Proposal deleted";
  if (raw.includes("ProposalNotFound")) return "Proposal not found";
  if (raw.includes("Unauthorized")) return "Unauthorized action";
  if (raw.includes("InvalidOption")) return "Invalid option";
  if (raw.includes("InvalidVoteSplit")) return "Invalid vote split";
  if (raw.includes("DuplicateOption")) return "Duplicate option";
  if (raw.includes("MultiSelectNotAllowed")) return "Proposal allows only one option";
  if (raw.includes("InvalidTimeRange")) return "Invalid time range";
  if (raw.includes("NoVotingPower")) return "No voting power";
  if (raw.includes("AlreadyDeleted")) return "Proposal already deleted";
  if (raw.includes("SpaceNotFound")) return "Space not found";
  if (raw.includes("DelegateRegistryNotSet")) return "Delegate registry is not configured";
  if (raw.includes("DelegationIdNotSet")) return "Delegation id is not set for this space";
  if (raw.includes("DelegationIdAlreadySet")) return "Delegation id is already set for this space";
  if (raw.includes("DelegationMismatch")) return "Delegation registry state does not match requested action";
  return raw;
}
