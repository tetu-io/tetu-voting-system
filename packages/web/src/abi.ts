export const votingAbi = [
  {
    type: "function",
    name: "createProposal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spaceId", type: "uint256" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "options", type: "string[]" },
      { name: "startAt", type: "uint64" },
      { name: "endAt", type: "uint64" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "getProposal",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "spaceId", type: "uint256" },
          { name: "author", type: "address" },
          { name: "title", type: "string" },
          { name: "description", type: "string" },
          { name: "options", type: "string[]" },
          { name: "startAt", type: "uint64" },
          { name: "endAt", type: "uint64" },
          { name: "deleted", type: "bool" },
          { name: "totalVotesCast", type: "uint256" }
        ]
      }
    ]
  },
  {
    type: "function",
    name: "getProposalTallies",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      { name: "options", type: "string[]" },
      { name: "tallies", type: "uint256[]" }
    ]
  },
  {
    type: "function",
    name: "vote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "optionIndex", type: "uint16" }
    ],
    outputs: []
  },
  {
    anonymous: false,
    type: "event",
    name: "ProposalCreated",
    inputs: [
      { indexed: true, name: "proposalId", type: "uint256" },
      { indexed: true, name: "spaceId", type: "uint256" },
      { indexed: true, name: "author", type: "address" },
      { indexed: false, name: "startAt", type: "uint64" },
      { indexed: false, name: "endAt", type: "uint64" }
    ]
  },
  {
    anonymous: false,
    type: "event",
    name: "VoteCast",
    inputs: [
      { indexed: true, name: "proposalId", type: "uint256" },
      { indexed: true, name: "voter", type: "address" },
      { indexed: false, name: "optionIndex", type: "uint16" },
      { indexed: false, name: "weight", type: "uint256" }
    ]
  },
  {
    anonymous: false,
    type: "event",
    name: "VoteRecast",
    inputs: [
      { indexed: true, name: "proposalId", type: "uint256" },
      { indexed: true, name: "voter", type: "address" },
      { indexed: false, name: "oldOptionIndex", type: "uint16" },
      { indexed: false, name: "oldWeight", type: "uint256" },
      { indexed: false, name: "newOptionIndex", type: "uint16" },
      { indexed: false, name: "newWeight", type: "uint256" }
    ]
  },
  {
    anonymous: false,
    type: "event",
    name: "ProposalDeleted",
    inputs: [
      { indexed: true, name: "proposalId", type: "uint256" },
      { indexed: true, name: "author", type: "address" }
    ]
  }
] as const;
