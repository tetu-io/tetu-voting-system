# tetu-voting-system

Simplified Snapshot-like voting system (v1) with:
- UUPS-upgradeable Solidity contracts,
- React web app with wagmi-based wallet integration,
- Node scripts in contracts package for proposal/vote/results/sync flows,
- delegation-aware voting power via Snapshot DelegateRegistry-compatible flow,
- proposal-level delegated weight ownership guard (prevents mid-proposal double counting),
- local-first Hardhat setup.

## Monorepo layout

- `packages/contracts` - Hardhat contracts, deploy/seed/upgrade scripts, contract tests
- `packages/web` - React + Vite UI (wagmi + Rainbow Wallet + WalletConnect/test wallet mode)
- `packages/shared` - shared types and generated local deployment artifacts

## Environment

Copy `.env.example` to `.env` and adjust values when needed.

Key variables:
- `VITE_RPC_URL` (used by internal test wallet mode and WalletConnect/mock transports; regular injected-wallet mode does not require this env)
- `VITE_CHAIN_ID`
- `VITE_VOTING_CONTRACT`
- `VITE_WALLETCONNECT_PROJECT_ID` (required for Rainbow Wallet/WalletConnect in browser mode)
- `VITE_BLOCK_TIME_SECONDS` (optional, UI hint for approximate block numbers on proposal create page)
- `VITE_USE_MOCK` (optional, when `true` UI uses internal in-memory mock wallet + mock contracts)
- `VITE_TEST_PRIVATE_KEY` (optional, used by e2e test wallet flow)
- `VITE_ENABLE_TEST_WALLET_LOGIN` (optional, default `false`; when `true` shows private-key login controls in UI for local/e2e flows)
- `SCRIPT_RPC_URL` (or `CLI_RPC_URL`)
- `SCRIPT_PRIVATE_KEY` (or `DEPLOYER_PRIVATE_KEY`)
- `CLI_CONTRACT`

## Frontend pages

The UI is route-based and includes:
- `/` - spaces table + create-space modal.
- `/spaces/:spaceId` - proposals table with pagination and quick actions.
- `/spaces/:spaceId/proposals/new` - dedicated proposal creation page (supports single-choice or multi-choice proposals).
- `/spaces/:spaceId/settings` - space settings (grant/revoke `admin` and `proposer` by address, delegation id setup).
- `/spaces/:spaceId` -> `Delegate` modal - delegate/undelegate for any user, plus owner-only delegation sync.
- `/proposals/:proposalId` - tallies, voters table, and vote action (single click for single-choice, arbitrary weight inputs for multi-choice that frontend auto-normalizes to percentages).

Wallet network guard (web3 safety):
- frontend is locked behind wallet connect in real mode (`VITE_USE_MOCK=false`): pages and contract reads open only after wallet connection;
- when an injected wallet is connected to a chain different from `VITE_CHAIN_ID`, frontend blocks all write actions;
- UI shows a warning with expected/current chain id and a `Switch Network` action;
- primary read model is on-chain pagination getters (spaces/proposals/voters) from `VotingCore`;
- event logs are fallback/diagnostic timeline only (not required for core page state correctness).

## Install

```bash
npm install
```

## Local stack

One command local stack (node -> deploy -> seed -> web):

```bash
npm run dev:stack
```

This command runs:
1. `hardhat node`
2. local deploy script (`VotingCore` proxy + `MockERC20`)
   - local `DelegateRegistry` is also deployed and connected to `VotingCore`
3. local seed script (balances + demo space + proposals)
4. web dev server

Dedicated one-command stack for Playwright e2e (includes deterministic test wallet env):

```bash
npm run dev:stack:e2e
```

## Package scripts

Contracts:

```bash
npm run build -w packages/contracts
npm run test -w packages/contracts
npm run deploy:network -w packages/contracts -- --network polygon
npm run deploy:network -w packages/contracts -- --network arbitrumSepolia
npm run deploy:local -w packages/contracts
npm run seed:local -w packages/contracts
npm run upgrade:smoke -w packages/contracts
npm run deploy:mock:arb-sepolia -w packages/contracts
MINT_TO=0xYourAddress MINT_AMOUNT=1000 MINT_TOKEN=0xYourToken npm run mint:mock:arb-sepolia -w packages/contracts
```

## Production deploy and upgrade

`packages/contracts` now supports a single universal `hardhat-deploy` flow for deploy and upgrade:

- first run on a network deploys `VotingCore` UUPS proxy,
- next runs on the same network compare on-chain implementation bytecode vs current build and upgrade only when changed,
- if nothing changed, script is no-op.

Per-network settings live in YAML files:

- `packages/contracts/deploy-config/polygon.yaml`
- `packages/contracts/deploy-config/arbitrumSepolia.yaml`

Useful per-network deploy knobs in these YAML files:

- `confirmations` - tx confirmations to wait for where applicable.
- `deploymentTimeoutMs` - timeout for OpenZeppelin upgrades deployment steps.
- `deploymentPollingIntervalMs` - polling interval for deployment receipt checks.

Run:

```bash
npm run deploy:network -w packages/contracts -- --network polygon
npm run deploy:network -w packages/contracts -- --network arbitrumSepolia
```

Required env keys for live networks:

- `DEPLOYER_PRIVATE_KEY` (single EOA; deployer and contract owner)
- `POLYGON_RPC_URL`
- `ARBITRUM_SEPOLIA_RPC_URL`

Optional:

- `ETHERSCAN_API_KEY` (recommended; Etherscan API v2 single key for verify)
- `POLYGONSCAN_API_KEY` (legacy fallback)
- `ARBISCAN_API_KEY` (legacy fallback)

Web:

```bash
npm run dev -w packages/web
npm run build -w packages/web
npm run test -w packages/web
npm run test:e2e -w packages/web
npm run test:e2e:full
```

Contract scripts (CLI-style):

```bash
npm run voting:cli -w packages/contracts -- --help
npm run voting:cli -w packages/contracts -- proposal:create --help
npm run voting:cli -w packages/contracts -- vote:cast --help
npm run voting:cli -w packages/contracts -- results:read --help
npm run voting:cli -w packages/contracts -- delegation:sync --help
```

`delegation:sync` details:
- `--days` is required and defines the sync window length;
- range start is calculated from the latest on-chain checkpoint (`checkpoint.toTs + 1 second`);
- if no checkpoint exists, range starts at `2021-11-01`;
- range end is `start + days`, capped by current time;
- sync is processed month-by-month and (for space owner) checkpoint dates are saved to contract for each successfully completed month.

Web delegation sync behavior:
- sync controls are visible only to the space owner;
- sync range is auto-filled from on-chain checkpoint (`getSpaceDelegationSyncPeriod().toTs`) to current time;
- if no checkpoint exists yet, UI falls back to the last 7 days for initial sync window.

## Quality gates

Run from repository root:

```bash
npm run build
npm run lint
npm run test
```

## Additional docs

- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- `docs/TESTING.md`
- `docs/TECH_SPEC.md`
- `docs/SECURITY_AUDIT.md`