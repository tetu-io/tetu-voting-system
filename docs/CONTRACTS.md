# Contracts Model (v1)

## 1. Purpose

Define on-chain entities, storage strategy, events, errors, and UUPS rules for the simplified voting system.

## 2. Main Contracts

- `VotingCore` (implementation):
  - business logic and storage.
- `VotingCoreProxy` (UUPS/ERC1967 proxy):
  - persistent state entrypoint.
- `MockERC20`:
  - local testing token with mint for test stand.

## 3. Entities

## 3.1 Space
- `id`
- `token` (`address`)
- `owner` (`address`)
- `name` (`string`)
- `description` (`string`)
- role mappings:
  - `admins[address] => bool`
  - `proposers[address] => bool`

## 3.2 Proposal
- `id`
- `spaceId`
- `author`
- `title`
- `description`
- `options` (`string[]`)
- `startAt`
- `endAt`
- `deleted` (`bool`)
- `totalVotesCast` (raw count of cast/recast actions)
- `allowMultipleChoices` (`bool`)

## 3.3 Vote State
- latest vote receipt per user/proposal:
  - `hasVoted` (`bool`)
  - `optionIndex` (`uint16`, backward-compatible first selected option)
  - `weight` (`uint256`)
  - `updatedAt` (`uint64`)
  - `optionIndices` (`uint16[]`)
  - `weightsBps` (`uint16[]`, sum = 10000)
- tallies:
  - `proposalOptionWeight[proposalId][optionIndex] => uint256`

## 4. Storage Layout Principles

- Use stable ordering for upgrade-safe layout.
- Keep mappings and arrays in append-only structure.
- Reserve storage gap (`uint256[50] __gap` or similar) for upgrades.
- Do not reorder/remove existing fields in upgrades.

## 5. Core External Functions

- Space:
  - `createSpace(token, name, description)`
  - `setAdmin(spaceId, account, allowed)`
  - `setProposer(spaceId, account, allowed)`
- Proposal:
  - `createProposal(spaceId, title, description, options, startAt, endAt, allowMultipleChoices)`
  - `deleteProposal(proposalId)`
- Voting:
  - `vote(proposalId, optionIndices, weightsBps)` (supports re-vote replace)
- Read:
  - `getSpace(spaceId)`
  - `getProposal(proposalId)`
  - `getProposalTallies(proposalId)`
  - `getVoteReceipt(proposalId, voter)`

## 6. Validation Rules

- `createProposal`:
  - proposer permission required,
  - options length >= 2,
  - `startAt < endAt`.
- `vote`:
  - proposal exists and not deleted,
  - now >= `startAt`,
  - now < `endAt`,
  - `optionIndices.length == weightsBps.length > 0`,
  - for single-choice proposal: exactly one selected option,
  - for multi-choice proposal: unique option indices only,
  - each bps > 0 and total `weightsBps == 10000`,
  - option index in range,
  - token balance > 0.
- `deleteProposal`:
  - only author,
  - allowed regardless of proposal time.

## 7. Re-vote Replace Algorithm

Given voter `V` for proposal `P`:
1. `newWeight = IERC20(token).balanceOf(V)`.
2. Split `newWeight` across selected options according to `weightsBps` (sum 100%).
3. If no previous vote:
   - add each split portion to selected option tallies.
4. If previous vote exists:
   - subtract old split portions from old selected options,
   - add new split portions to new selected options.
5. Save receipt (`optionIndices`, `weightsBps`, `newWeight`, `updatedAt`).

This keeps tallies consistent with the latest recorded vote per voter.

## 8. Events

- `SpaceCreated(spaceId, owner, token, name)`
- `SpaceAdminUpdated(spaceId, account, allowed)`
- `SpaceProposerUpdated(spaceId, account, allowed)`
- `ProposalCreated(proposalId, spaceId, author, startAt, endAt, allowMultipleChoices)`
- `ProposalDeleted(proposalId, author)`
- `VoteCast(proposalId, voter, optionIndices, weightsBps, distributedWeights, totalWeight)`
- `VoteRecast(proposalId, voter, oldTotalWeight, optionIndices, weightsBps, distributedWeights, newTotalWeight)`
- `Upgraded(implementation)` (from UUPS stack)

## 9. Custom Errors

- `Unauthorized()`
- `InvalidTimeRange()`
- `ProposalNotFound()`
- `ProposalDeleted()`
- `ProposalNotStarted()`
- `ProposalEnded()`
- `InvalidOption()`
- `InvalidVoteSplit()`
- `DuplicateOption()`
- `MultiSelectNotAllowed()`
- `NoVotingPower()`
- `AlreadyDeleted()`

## 10. UUPS Upgrade Constraints

- `_authorizeUpgrade` only contract owner (v1) or dedicated upgrader role.
- Upgrade process:
  - deploy new implementation,
  - run storage compatibility checks,
  - execute `upgradeToAndCall`,
  - run smoke checks (read/write/vote) post-upgrade.
- Forbid self-destruct/delegatecall unsafe paths in implementation.

## 11. Contract Test Minimum

- Unit:
  - permissions and role updates,
  - proposal validation errors,
  - vote and re-vote tally correctness,
  - voting window boundaries.
- Upgrade:
  - proxy retains state after implementation upgrade.
- Integration:
  - UI/CLI expected read paths compatible with exposed views/events.
