export const votingAbi = [
  "function createProposal(uint256 spaceId,string title,string description,string[] options,uint64 startAt,uint64 endAt) returns (uint256)",
  "function vote(uint256 proposalId,uint16 optionIndex)",
  "function getProposal(uint256 proposalId) view returns ((uint256 id,uint256 spaceId,address author,string title,string description,string[] options,uint64 startAt,uint64 endAt,bool deleted,uint256 totalVotesCast))",
  "function getProposalTallies(uint256 proposalId) view returns (string[] options,uint256[] tallies)",
  "function getVoteReceipt(uint256 proposalId,address voter) view returns ((bool hasVoted,uint16 optionIndex,uint256 weight,uint64 updatedAt))",
  "event ProposalCreated(uint256 indexed proposalId,uint256 indexed spaceId,address indexed author,uint64 startAt,uint64 endAt)"
];
