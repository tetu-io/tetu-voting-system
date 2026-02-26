# Implementation Roadmap (v1)

## Phase 1: Monorepo Bootstrap
- Create workspace structure for `contracts`, `web`, `cli`.
- Add shared tooling (TypeScript, lint, format).
- Add root scripts for local orchestration.

Deliverable:
- Repository can install dependencies and run package-level commands.

## Phase 2: Contracts MVP
- Implement `VotingCore` logic with spaces/proposals/voting/re-vote.
- Add UUPS proxy deployment path.
- Add mock ERC20 for local setup.
- Cover all validation and access control errors.

Deliverable:
- Contract test suite green for core domain behavior.

## Phase 3: UI MVP
- Integrate Rainbow wallet.
- Build pages for proposal list/details/create.
- Implement vote and re-vote interactions.
- Render tallies and status from storage; render timeline from events.

Deliverable:
- User can complete end-to-end voting flow through browser.

## Phase 4: CLI MVP
- Implement:
  - `proposal:create`
  - `vote:cast`
  - `results:read`
- Provide readable and JSON output.

Deliverable:
- CLI and UI operate on same deployed contract state.

## Phase 5: Local E2E Stand
- Implement one-command stack startup:
  - local node,
  - deploy,
  - seed,
  - UI start.
- Add Playwright tests for critical flows.

Deliverable:
- Repeatable local E2E in CI-like conditions.

## Edge Cases Checklist

- Proposal with invalid time range (`startAt >= endAt`).
- Vote before `startAt`.
- Vote at/after `endAt`.
- Vote on deleted proposal.
- Re-vote to same option (idempotent handling decision).
- Re-vote after balance change.
- Proposal author deletes active proposal with existing votes.
- Non-proposer tries to create proposal.
- Non-admin tries to manage proposers/admins.

## Risk Register

- Gas growth due to full on-chain text/options.
- Dynamic vote power (balance at tx time) can be strategically exploited.
- UUPS upgrade mistakes can break storage compatibility.
- Event-driven UI timeline can diverge if indexing is incomplete.

## Exit Criteria (v1 Ready)

- Core requirements documented and implemented.
- Contract tests cover all edge cases above.
- Playwright tests pass for critical paths.
- Upgrade test proves proxy state retention.
- Local one-command stack works from clean clone.
