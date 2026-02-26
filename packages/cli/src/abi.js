export const votingAbi = [
  "function createProposal(uint256 spaceId,string title,string description,string[] options,uint64 startAt,uint64 endAt,bool allowMultipleChoices) returns (uint256)",
  "function vote(uint256 proposalId,uint16[] optionIndices,uint16[] weightsBps)",
  "function getProposal(uint256 proposalId) view returns ((uint256 id,uint256 spaceId,address author,string title,string description,string[] options,uint64 startAt,uint64 endAt,bool deleted,uint256 totalVotesCast,bool allowMultipleChoices))",
  "function getProposalTallies(uint256 proposalId) view returns (string[] options,uint256[] tallies)",
  "function getVoteReceipt(uint256 proposalId,address voter) view returns ((bool hasVoted,uint16 optionIndex,uint256 weight,uint64 updatedAt,uint16[] optionIndices,uint16[] weightsBps))",
  "event ProposalCreated(uint256 indexed proposalId,uint256 indexed spaceId,address indexed author,uint64 startAt,uint64 endAt,bool allowMultipleChoices)"
];
