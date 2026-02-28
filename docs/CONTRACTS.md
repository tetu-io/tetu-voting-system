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
- `delegationId` (`bytes32`, manually set per space)
- role mappings:
  - `admins[address] => bool`
  - `proposers[address] => bool`
- index storage:
  - `spaceIds[]` (enumerable spaces list for pagination)

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
- index storage:
  - `proposalIdsBySpace[spaceId] => uint256[]` (enumerable per-space proposals)

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
- voter index:
  - `proposalVoters[proposalId] => address[]`
  - `proposalVoterIndexed[proposalId][voter] => bool` (first-vote guard for unique list)

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
- `setSpaceDelegationId(spaceId, delegationId)`
- Proposal:
  - `createProposal(spaceId, title, description, options, startAt, endAt, allowMultipleChoices)`
  - `deleteProposal(proposalId)`
- Voting:
  - `vote(proposalId, optionIndices, weightsBps)` (supports re-vote replace)
- Delegation:
  - `setDelegateRegistry(registry)`
  - `syncDelegationForSpace(spaceId, delegator)`
  - `syncDelegationsForSpace(spaceId, delegators[])`
  - `setSpaceDelegationSyncPeriod(spaceId, fromTs, toTs)` (space owner only, monotonic checkpoint updates)
  - `setDelegateForSpace(spaceId, delegate)` / `clearDelegateForSpace(spaceId)` (sync wrappers that require registry state to match requested action)
  - `getSpaceDelegate(spaceId, delegator)`
  - `getSpaceDelegationSyncPeriod(spaceId)`
- Read:
  - `getSpace(spaceId)`
  - `getSpaceIdsCount()`
  - `getSpaceIdsPage(offset, limit)`
  - `getProposal(proposalId)`
  - `getProposalIdsBySpaceCount(spaceId, includeDeleted)`
  - `getProposalIdsBySpacePage(spaceId, offset, limit, includeDeleted)`
  - `getProposalTallies(proposalId)`
  - `getVoteReceipt(proposalId, voter)`
  - `getProposalVotersCount(proposalId)`
  - `getProposalVotersPage(proposalId, offset, limit)`
  - `getVotingPower(spaceId, voter)`

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
  - effective voting power > 0 (direct balance + active inbound delegations),
  - each underlying weight owner can be controlled by only one voter per proposal
    (prevents double counting after mid-proposal delegation changes).
- `deleteProposal`:
  - only author,
  - allowed regardless of proposal time.

## 7. Re-vote Replace Algorithm

Given voter `V` for proposal `P`:
1. Build effective contributors for `V`:
   - `V` itself (unless currently delegated away),
   - inbound delegators actively delegating to `V` for this space.
2. Ensure contributor owners are not already claimed by another voter in `P`
   (otherwise revert `WeightAlreadyClaimed`).
3. `newWeight = sum(balanceOf(contributor))`.
4. Split `newWeight` across selected options according to `weightsBps` (sum 100%).
5. If no previous vote:
   - claim contributor ownership for `V`,
   - add each split portion to selected option tallies.
6. If previous vote exists:
   - release old contributor ownership from receipt,
   - claim current contributor ownership for `V`,
   - subtract old split portions from old selected options,
   - add new split portions to new selected options.
7. Save receipt (`optionIndices`, `weightsBps`, `newWeight`, `updatedAt`, contributors).

This keeps tallies consistent with the latest vote per voter while preventing
the same token owner's weight from being counted by multiple voters in one proposal.

## 8. Events

- `SpaceCreated(spaceId, owner, token, name)`
- `SpaceAdminUpdated(spaceId, account, allowed)`
- `SpaceProposerUpdated(spaceId, account, allowed)`
- `ProposalCreated(proposalId, spaceId, author, startAt, endAt, allowMultipleChoices)`
- `ProposalDeleted(proposalId, author)`
- `VoteCast(proposalId, voter, optionIndices, weightsBps, distributedWeights, totalWeight)`
- `VoteRecast(proposalId, voter, oldTotalWeight, optionIndices, weightsBps, distributedWeights, newTotalWeight)`
- `DelegateRegistryUpdated(delegateRegistryAddress)`
- `SpaceDelegationIdUpdated(spaceId, delegationId, updater)`
- `SpaceDelegateSet(spaceId, delegationId, delegator, delegate)`
- `SpaceDelegateCleared(spaceId, delegationId, delegator, delegate)`
- `SpaceDelegationSynced(spaceId, delegationId, delegator, delegate)`
- `SpaceDelegationSyncPeriodUpdated(spaceId, updater, fromTs, toTs)`
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
- `DelegateRegistryNotSet()`
- `DelegationIdNotSet()`
- `DelegationIdAlreadySet()`
- `DelegationMismatch()`
- `InvalidSyncPeriod()`
- `WeightAlreadyClaimed(address weightOwner, address currentController)`

## 10. UUPS Upgrade Constraints

- `_authorizeUpgrade` only contract owner (v1) or dedicated upgrader role.
- Upgrade process:
  - deploy new implementation,
  - run storage compatibility checks,
  - execute `upgradeToAndCall`,
  - run smoke checks (read/write/vote) post-upgrade.
- Forbid self-destruct/delegatecall unsafe paths in implementation.

## 10.1 Deployment/Upgrade Automation

- Production deploy uses `hardhat-deploy` with one script: `packages/contracts/deploy/01_voting_core.js`.
- The script is universal:
  - if proxy is absent -> deploy `VotingCore` UUPS proxy and implementation,
  - if proxy exists and implementation bytecode changed -> upgrade proxy,
  - if proxy exists and bytecode is same -> no-op.
- Network config is file-based and separate per network:
  - `packages/contracts/deploy-config/polygon.yaml`
  - `packages/contracts/deploy-config/arbitrumSepolia.yaml`
  - per-network knobs include `confirmations`, `deploymentTimeoutMs`, `deploymentPollingIntervalMs`.
- Network selection is standard hardhat argument:
  - `hardhat deploy --network polygon`
  - `hardhat deploy --network arbitrumSepolia`
- Governance/deploy model is intentionally single-EOA:
  - deployer key from `DEPLOYER_PRIVATE_KEY`,
  - deploy script enforces `initialOwner == deployer`.

## 10.2 Current Contract Caveat

- `VotingCoreV2.initializeV2()` is externally callable (reinitializer).
- It is currently empty, so no direct privilege escalation now.
- If future versions add meaningful logic there, access control must be explicit (e.g. `onlyOwner`) or logic must remain harmless.

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
