export const votingAbi = [
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "InvalidTimeRange", inputs: [] },
  { type: "error", name: "ProposalNotFound", inputs: [] },
  { type: "error", name: "ProposalIsDeleted", inputs: [] },
  { type: "error", name: "ProposalNotStarted", inputs: [] },
  { type: "error", name: "ProposalEnded", inputs: [] },
  { type: "error", name: "InvalidOption", inputs: [] },
  { type: "error", name: "InvalidVoteSplit", inputs: [] },
  { type: "error", name: "DuplicateOption", inputs: [] },
  { type: "error", name: "MultiSelectNotAllowed", inputs: [] },
  { type: "error", name: "NoVotingPower", inputs: [] },
  { type: "error", name: "AlreadyDeleted", inputs: [] },
  {
    type: "function",
    name: "createSpace",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "name", type: "string" },
      { name: "description", type: "string" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "setAdmin",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spaceId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "allowed", type: "bool" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "setProposer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spaceId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "allowed", type: "bool" }
    ],
    outputs: []
  },
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
      { name: "endAt", type: "uint64" },
      { name: "allowMultipleChoices", type: "bool" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "deleteProposal",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "getSpace",
    stateMutability: "view",
    inputs: [{ name: "spaceId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "token", type: "address" },
          { name: "owner", type: "address" },
          { name: "name", type: "string" },
          { name: "description", type: "string" }
        ]
      }
    ]
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
          { name: "totalVotesCast", type: "uint256" },
          { name: "allowMultipleChoices", type: "bool" }
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
      { name: "optionIndices", type: "uint16[]" },
      { name: "weightsBps", type: "uint16[]" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "getVoteReceipt",
    stateMutability: "view",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "voter", type: "address" }
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "hasVoted", type: "bool" },
          { name: "optionIndex", type: "uint16" },
          { name: "weight", type: "uint256" },
          { name: "updatedAt", type: "uint64" },
          { name: "optionIndices", type: "uint16[]" },
          { name: "weightsBps", type: "uint16[]" }
        ]
      }
    ]
  },
  {
    type: "function",
    name: "isAdmin",
    stateMutability: "view",
    inputs: [
      { name: "spaceId", type: "uint256" },
      { name: "account", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "isProposer",
    stateMutability: "view",
    inputs: [
      { name: "spaceId", type: "uint256" },
      { name: "account", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    anonymous: false,
    type: "event",
    name: "SpaceCreated",
    inputs: [
      { indexed: true, name: "spaceId", type: "uint256" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "name", type: "string" }
    ]
  },
  {
    anonymous: false,
    type: "event",
    name: "SpaceAdminUpdated",
    inputs: [
      { indexed: true, name: "spaceId", type: "uint256" },
      { indexed: true, name: "account", type: "address" },
      { indexed: false, name: "allowed", type: "bool" }
    ]
  },
  {
    anonymous: false,
    type: "event",
    name: "SpaceProposerUpdated",
    inputs: [
      { indexed: true, name: "spaceId", type: "uint256" },
      { indexed: true, name: "account", type: "address" },
      { indexed: false, name: "allowed", type: "bool" }
    ]
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
      { indexed: false, name: "endAt", type: "uint64" },
      { indexed: false, name: "allowMultipleChoices", type: "bool" }
    ]
  },
  {
    anonymous: false,
    type: "event",
    name: "VoteCast",
    inputs: [
      { indexed: true, name: "proposalId", type: "uint256" },
      { indexed: true, name: "voter", type: "address" },
      { indexed: false, name: "optionIndices", type: "uint16[]" },
      { indexed: false, name: "weightsBps", type: "uint16[]" },
      { indexed: false, name: "distributedWeights", type: "uint256[]" },
      { indexed: false, name: "totalWeight", type: "uint256" }
    ]
  },
  {
    anonymous: false,
    type: "event",
    name: "VoteRecast",
    inputs: [
      { indexed: true, name: "proposalId", type: "uint256" },
      { indexed: true, name: "voter", type: "address" },
      { indexed: false, name: "oldTotalWeight", type: "uint256" },
      { indexed: false, name: "optionIndices", type: "uint16[]" },
      { indexed: false, name: "weightsBps", type: "uint16[]" },
      { indexed: false, name: "distributedWeights", type: "uint256[]" },
      { indexed: false, name: "newTotalWeight", type: "uint256" }
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
