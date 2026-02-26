# Testing and Local E2E Stand (v1)

## 1. Test Levels

- Contract unit tests (Hardhat):
  - roles/access,
  - proposal lifecycle checks,
  - vote/re-vote tally math,
  - ended proposal rejection.
- Integration tests:
  - proxy deployment + initialization,
  - upgrade smoke path,
  - deploy script idempotency (re-run does not force upgrade without bytecode change).
- UI E2E tests (Playwright):
  - wallet connect + header menu/logout,
  - create space via modal,
  - navigate route-based pages,
  - set admin in space settings,
  - create proposal from dedicated page,
  - cast single-choice vote,
  - cast multi-choice weighted vote (percent split = 100%),
  - verify voters list/tallies and on-chain reads.

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
- `VITE_USE_MOCK=false` (real-contract e2e mode stays default).

Manual UI mock run (wallet+contracts fully in-memory, no on-chain assertions):

```bash
VITE_USE_MOCK=true npm run dev -w packages/web
```

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
- Create space from modal on `/`.
- Open settings page and set admin.
- Open dedicated proposal-create page and create proposal.
- Open proposal details page and cast single-choice vote.
- Create multi-choice proposal and cast weighted split vote.
- Verify voters/tallies in UI and on-chain.

## 4.2 Runtime health checks
- Fail test on `pageerror`.
- Fail test on critical `console.error`.
- Ensure UI renders wallet/status controls and actionable forms.

## 5. Deterministic Time Control

- For ended-proposal checks in frontend e2e, use RPC time control (`evm_increaseTime` + `evm_mine`) instead of fixed waits.
- Contract-level boundary tests also use Hardhat helpers (`evm_setNextBlockTimestamp`, `evm_increaseTime`, `evm_mine`) in unit/integration suites.

## 6. Definition of Done for Test Suite

- All contract tests pass.
- Playwright suite passes on fresh local stack.
- At least one upgrade test proves state preservation after UUPS implementation switch.
- At least one deploy automation test proves no-op behavior on second deploy run.
