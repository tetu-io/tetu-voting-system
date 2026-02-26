# CLI and UI Flows (v1)

## 1. UI Flows (Injected/Test Wallet in local stand)

UI has two modes:
- Real mode (`VITE_USE_MOCK=false`, default): injected/test wallet + on-chain contracts.
- Mock mode (`VITE_USE_MOCK=true`): in-memory wallet and contract simulation inside UI, no RPC dependency for writes/reads.

## 1.1 Connect Wallet + Header Menu
1. User opens app.
2. If not connected, user sees login control (`Connect Wallet` for injected or `Connect Mock Wallet` in mock mode).
3. If connected, user sees wallet in header and hamburger menu.
4. Hamburger menu currently contains logout action.

## 1.2 Main Page (Spaces)
1. User opens `/`.
2. UI loads spaces from `SpaceCreated` events + `getSpace` reads.
3. Spaces are shown in table with client pagination.
4. `Create Space` opens modal and sends `createSpace`.
5. After confirmation, UI navigates to created space page.

## 1.3 Space Page
1. User opens `/spaces/:spaceId`.
2. UI loads proposals for this space from events (`ProposalCreated`/`ProposalDeleted`) + `getProposal` reads.
3. Proposals are shown in paginated table.
4. Top controls:
   - `Create Proposal` -> dedicated route,
   - `Settings` -> space settings route.

## 1.4 Create Proposal from Dedicated Page
1. User opens `/spaces/:spaceId/proposals/new`.
2. User fills:
   - title,
   - description,
   - options (2+),
   - `allow multi-select` checkbox (optional),
   - start/end dates (`datetime-local`).
3. UI converts dates to unix timestamps.
4. UI shows approximate block numbers using `VITE_BLOCK_TIME_SECONDS`.
5. UI sends `createProposal` tx with mode flag and routes to proposal details.

## 1.5 Space Settings
1. User opens `/spaces/:spaceId/settings`.
2. User fills admin address and allowed flag.
3. UI sends `setAdmin`.

## 1.6 Proposal Page
1. User opens `/proposals/:proposalId`.
2. UI shows:
   - proposal metadata,
   - current tallies (`getProposalTallies`),
   - voters list from `VoteCast`/`VoteRecast` events.
3. UI resolves voting power via ERC20 `balanceOf` in space token.
4. Vote form depends on proposal mode:
   - single-choice: one-click vote button per option (100% to selected option),
   - multi-choice: option checkboxes + percentage inputs (sum must be exactly 100%).
5. Vote action is enabled only when:
   - wallet connected,
   - proposal active,
   - voting power > 0.
6. On vote/re-vote, UI refreshes tallies and voters.

## 1.7 Legacy local wallet path
1. In real mode, deterministic test wallet can be connected from header by private key input (for local e2e/dev only).
2. Injected wallet (or deterministic test wallet in e2e stand) connects to local Hardhat network.
3. UI validates chain id and shows network mismatch warning if needed.

## 1.8 Ended Proposal Behavior
- If `now >= endAt`, vote button is disabled in UI.
- Any forced submit attempt should still fail on-chain with `ProposalEnded`.

## 2. CLI Flows

## 2.1 `proposal:create`
Inputs:
- `--rpc-url`
- `--private-key`
- `--contract`
- `--space-id`
- `--title`
- `--description`
- `--options` (comma separated or repeated flag)
- `--start-at`
- `--end-at`
- `--allow-multi` (optional, enables multi-choice mode)

Output:
- tx hash,
- created proposal id (parsed from event),
- human-readable success line.

## 2.2 `vote:cast`
Inputs:
- `--rpc-url`
- `--private-key`
- `--contract`
- `--proposal-id`
- `--option`
  - CLI keeps single-option UX and sends a 100% split for the selected option.

Output:
- tx hash,
- whether this was first vote or re-vote,
- effective weight used.

## 2.3 `results:read`
Inputs:
- `--rpc-url`
- `--contract`
- `--proposal-id`

Output:
- proposal metadata,
- options and tallies,
- vote status (active/ended/deleted),
- optional JSON with `--json`.

## 3. UX and Error Handling Rules

- Always display contract revert reason mapped to human text.
- Before tx send, run optimistic client-side checks:
  - options valid,
  - time window valid,
  - wallet connected.
- Do not trust client-only checks for security; contract checks are final.

## 4. Read Strategy (Storage + Events)

- Base state:
  - from `getProposal` and `getProposalTallies`.
- History:
  - from `SpaceCreated`, `SpaceAdminUpdated`, `SpaceProposerUpdated`, `ProposalCreated`, `VoteCast`, `VoteRecast`, `ProposalDeleted`.
- Reconciliation:
  - tallies shown from storage,
  - events enrich timeline and debugging, including proposal deletion visibility.
