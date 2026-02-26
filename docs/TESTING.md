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

Expected single command:

```bash
npm run dev:stack
```

This command should orchestrate:
1. `hardhat node` startup,
2. contract deploy (`VotingCore` impl + proxy + token),
3. seed script:
   - mint test ERC20 balances,
   - create one demo space,
   - create demo proposals,
4. start React app with local RPC config.

For full Playwright frontend e2e (real contracts + deterministic wallet), use:

```bash
npm run dev:stack:e2e
```

This variant injects:
- `VITE_RPC_URL=http://127.0.0.1:8545`
- `VITE_CHAIN_ID=31337`
- deployed `VITE_VOTING_CONTRACT`
- deterministic `VITE_TEST_PRIVATE_KEY` for in-UI test wallet connect.

## 3. Seed Data Requirements

- Accounts:
  - owner/admin/proposer/voters.
- Token:
  - deterministic balances for predictable test assertions.
- Domain:
  - at least one active and one ended proposal.

## 4. Playwright Critical Paths

## 4.1 Full frontend scenario (single e2e)
- Connect test wallet from UI.
- Create space from UI.
- Set admin from UI.
- Set proposer from UI.
- Create proposal from UI.
- Cast first vote from UI.
- Re-cast vote from UI.
- Create short-lived proposal and assert ended vote rejection from UI.
- Delete proposal from UI.
- Verify on-chain reads (space/roles/proposal/tallies/receipt/deleted flag) after each critical step.

## 4.2 Runtime health checks
- Fail test on `pageerror`.
- Fail test on critical `console.error`.
- Ensure UI renders wallet/status controls and actionable forms.

## 5. Deterministic Time Control

- For short-lived proposal checks, use very small `endAt` windows in e2e input and assert rejection path after expiration.
- Optional contract-level boundary tests still use Hardhat helpers (`evm_setNextBlockTimestamp`, `evm_increaseTime`, `evm_mine`) in unit/integration suites.

## 6. Definition of Done for Test Suite

- All contract tests pass.
- Playwright suite passes on fresh local stack.
- At least one upgrade test proves state preservation after UUPS implementation switch.
