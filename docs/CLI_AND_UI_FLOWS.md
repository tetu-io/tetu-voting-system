# CLI and UI Flows (v1)

## 1. UI Flows (Rainbow Wallet)

## 1.1 Connect Wallet
1. User opens app.
2. Clicks connect.
3. Rainbow wallet connects to local Hardhat network.
4. UI validates chain id and shows network mismatch warning if needed.

## 1.2 Create Proposal from UI
1. User opens space page.
2. UI checks proposer permission.
3. User fills:
   - title,
   - description,
   - options (2+),
   - start/end dates.
4. UI sends `createProposal` tx.
5. On confirmation:
   - proposal appears in list,
   - `ProposalCreated` event is shown in activity feed.

## 1.3 Vote / Re-vote from UI
1. User opens proposal details.
2. UI shows current tally per option from view call.
3. User selects option and confirms transaction.
4. Contract computes weight by current token balance.
5. If previous vote exists:
   - old tally adjusted down,
   - new tally adjusted up.
6. UI refreshes tallies and appends vote event.

## 1.4 Ended Proposal Behavior
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
  - from `ProposalCreated`, `VoteCast`, `VoteRecast`, `ProposalDeleted`.
- Reconciliation:
  - tallies shown from storage,
  - events only enrich timeline and debugging.
