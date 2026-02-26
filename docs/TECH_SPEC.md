# Simplified Snapshot Technical Specification (v1)

## 1. Goal

Build a simplified Snapshot-like voting system with:
- fully on-chain state (no backend/indexer required for correctness),
- local-first development on Hardhat,
- React UI + CLI for key user flows,
- ERC20-weighted voting,
- upgradeable contracts via UUPS.

This document is the source of truth for v1 requirements and architecture boundaries.

## 2. Scope and Non-goals

### In scope (v1)
- Space creation and administration.
- Proposal creation and deletion by author.
- Voting with ERC20 balance weight.
- Per-space delegation support through Snapshot-compatible `DelegateRegistry`.
- Re-vote support where latest vote replaces previous vote.
- Results rendering in UI from on-chain storage + events.
- Proposal creation from UI and CLI.
- Local E2E test stand: one command starts node + deploy + UI.

### Out of scope (v1)
- Mainnet/testnet production deployment flows.
- Off-chain signatures and gasless voting.
- IPFS/Arweave content storage.
- Multi-token voting (ERC721/ERC1155).

## 3. Fixed Product Decisions

- Network at start: local Hardhat only.
- Vote weight: current ERC20 balance at vote transaction execution time.
- Proposal voting window: vote allowed only before `endAt`.
- Re-vote mode: replace previous choice and adjust tallies.
- Space permissions: `owner + admins`.
- Proposal content: full title/description/options on-chain.
- UI wallet: Rainbow wallet.
- CLI v1 commands: create proposal, cast vote, read results.
- Read model in UI: mixed storage reads + event reads.
- Contract upgrades: UUPS proxy pattern.
- Repository strategy: adapt current repo with monorepo structure.

## 4. Functional Requirements

## 4.1 Spaces
- Any address can create a space.
- Space stores:
  - `owner`,
  - admin list,
  - ERC20 token used for vote weight,
  - metadata (name, optional short description).
- Owner can add/remove admins.
- Owner/admins can manage proposer permissions.

## 4.2 Proposers
- Default proposer is the space owner.
- Owner/admin can add or remove proposer accounts.
- Only allowed proposer can create proposals in that space.

## 4.3 Proposals
- Proposal fields:
  - `spaceId`,
  - `author`,
  - `title`,
  - `description`,
  - options array (2+),
  - `startAt`,
  - `endAt`,
  - `deleted` flag.
- Start can be in the future.
- Author can delete proposal at any time.
- Deleted proposal cannot be voted on and is excluded from active lists.

## 4.4 Voting
- Valid only when:
  - proposal exists and is not deleted,
  - current time is within active range:
    - if before `startAt`: reject,
    - if at/after `endAt`: reject.
- Vote weight is read as `IERC20(token).balanceOf(msg.sender)` at execution time.
- User can re-vote; latest selected option replaces previous option.
- On re-vote, system subtracts previous weight/option contribution and adds new one.
- No token transfer or lock is performed.

## 4.5 Results
- Canonical result is on-chain storage tallies per option.
- Events are used for UI history and faster incremental rendering.
- After `endAt`, state is read-only from voting perspective.

## 5. Smart Contract Design

## 5.1 High-level contracts
- `VotingCore` (UUPS implementation): spaces, proposals, votes, tallies.
- `VotingCoreProxy` (ERC1967 proxy): upgrade entrypoint.
- `MockERC20` (for local stand/testing).

## 5.2 Core data model (logical)
- `Space`
  - `token`,
  - `owner`,
  - `admins`,
  - `proposers`.
- `Proposal`
  - metadata fields,
  - time bounds,
  - options,
  - tallies,
  - deleted flag.
- `VoteReceipt`
  - previous selected option (if any),
  - previous effective weight,
  - `lastVotedAt`.

## 5.3 Access control model
- Space owner:
  - manage admins,
  - manage proposers.
- Space admin:
  - manage proposers.
- Proposer:
  - create proposals.
- Proposal author:
  - delete own proposal.

## 5.4 Upgradeability requirements (UUPS)
- Implementation uses OpenZeppelin UUPS base.
- `_authorizeUpgrade` restricted to a governance role (v1: contract owner).
- Storage layout must reserve gaps for future upgrades.
- Upgrade test is mandatory in contract test suite.

## 6. UI Requirements (React)

- Connect via Rainbow wallet to local Hardhat chain.
- Screens:
  - spaces list/detail,
  - create proposal form,
  - proposal details with options and live tallies,
  - vote/re-vote action.
- Read model:
  - primary: contract view methods for current state,
  - secondary: events for timeline and audit trail.
- Local mode:
  - RPC and chainId configurable via environment.

## 7. CLI Requirements

- Commands:
  - `proposal:create`
  - `vote:cast`
  - `results:read`
- Common flags:
  - `--rpc-url`,
  - `--private-key`,
  - `--contract`,
  - domain-specific ids/options.
- Output:
  - human-readable by default,
  - optional JSON mode for scripting.

## 8. Local E2E Stand

Single command should:
1. start local Hardhat node,
2. deploy proxy + implementation + mock token,
3. seed demo data:
   - token balances,
   - one space,
   - sample proposals,
4. start React UI configured for local chain.

Playwright E2E must validate:
- create proposal from UI,
- vote and re-vote flow,
- vote rejection after end date,
- CLI-created proposal visibility in UI,
- result consistency between storage and rendered values.

## 9. Security and Correctness Constraints

- Reentrancy guard around state-changing vote paths.
- Strict input checks:
  - options length >= 2,
  - `startAt < endAt`,
  - selected option index in range.
- Event coverage for all state-changing actions.
- No reliance on off-chain indexing for correctness.
- Because vote weight is dynamic at tx time, users can move tokens between votes; this is accepted by v1 design.

## 10. Risks and Trade-offs

- Full on-chain text increases gas cost and proposal size limits.
- Dynamic `balanceOf` at vote time is simple but not manipulation-resistant between users over time.
- UUPS brings operational overhead and upgrade governance risk.
- Mixed storage+events UI reads require careful reconciliation logic.

## 11. Acceptance Criteria

- Documents in `docs/` fully specify architecture, contract model, UI/CLI flows, and tests.
- Requirements align with agreed decisions.
- Clear boundaries between v1 delivered scope and future enhancements.
