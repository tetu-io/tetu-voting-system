# Testing and Local E2E Stand (v1)

## 1. Test Levels

- Contract unit tests (Hardhat):
  - roles/access,
  - proposal lifecycle checks,
  - vote/re-vote tally math,
  - ended proposal rejection.
- Integration tests:
  - proxy deployment + initialization,
  - upgrade smoke path.
- UI E2E tests (Playwright):
  - wallet connect,
  - create proposal,
  - cast vote,
  - recast vote,
  - reject after end time,
  - verify UI values match on-chain reads.

## 2. One-command Local Stand

Expected single command (example):

```bash
pnpm dev:stack
```

This command should orchestrate:
1. `hardhat node` startup,
2. contract deploy (`VotingCore` impl + proxy + token),
3. seed script:
   - mint test ERC20 balances,
   - create one demo space,
   - create demo proposals,
4. start React app with local RPC config.

## 3. Seed Data Requirements

- Accounts:
  - owner/admin/proposer/voters.
- Token:
  - deterministic balances for predictable test assertions.
- Domain:
  - at least one active and one ended proposal.

## 4. Playwright Critical Paths

## 4.1 UI create proposal
- Connect wallet.
- Open create form.
- Submit valid data.
- Assert created proposal appears in list and details page.

## 4.2 Vote and re-vote
- Cast first vote.
- Capture tally.
- Re-vote another option.
- Assert old option decreased and new option increased correctly.

## 4.3 Vote after deadline
- Move chain time beyond `endAt`.
- Attempt vote.
- Assert transaction rejection and error message in UI.

## 4.4 CLI + UI interoperability
- Create proposal via CLI.
- Refresh UI.
- Assert proposal is visible and votable in UI.

## 5. Deterministic Time Control

- Use Hardhat time helpers:
  - `evm_setNextBlockTimestamp`,
  - `evm_increaseTime`,
  - `evm_mine`.
- Required for reliable tests around `startAt/endAt` boundaries.

## 6. Definition of Done for Test Suite

- All contract tests pass.
- Playwright suite passes on fresh local stack.
- At least one upgrade test proves state preservation after UUPS implementation switch.
