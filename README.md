# tetu-voting-system

Simplified Snapshot-like voting system (v1) with:
- UUPS-upgradeable Solidity contracts,
- React web app with wagmi-based wallet integration,
- Node CLI for proposal/vote/results flows,
- local-first Hardhat setup.

## Monorepo layout

- `packages/contracts` - Hardhat contracts, deploy/seed/upgrade scripts, contract tests
- `packages/web` - React + Vite UI (wagmi + injected/test wallet mode)
- `packages/cli` - CLI commands (`proposal:create`, `vote:cast`, `results:read`)
- `packages/shared` - shared types and generated local deployment artifacts

## Environment

Copy `.env.example` to `.env` and adjust values when needed.

Key variables:
- `VITE_RPC_URL`
- `VITE_CHAIN_ID`
- `VITE_VOTING_CONTRACT`
- `VITE_BLOCK_TIME_SECONDS` (optional, UI hint for approximate block numbers on proposal create page)
- `VITE_USE_MOCK` (optional, when `true` UI uses internal in-memory mock wallet + mock contracts)
- `VITE_TEST_PRIVATE_KEY` (optional, used by e2e test wallet flow)
- `CLI_RPC_URL`
- `CLI_CONTRACT`

## Frontend pages

The UI is route-based and includes:
- `/` - spaces table + create-space modal.
- `/spaces/:spaceId` - proposals table with pagination and quick actions.
- `/spaces/:spaceId/proposals/new` - dedicated proposal creation page (supports single-choice or multi-choice proposals).
- `/spaces/:spaceId/settings` - space settings (admin role assignment).
- `/proposals/:proposalId` - tallies, voters table, and vote action (single click for single-choice, percentage split form for multi-choice).

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
```

## Production deploy and upgrade

`packages/contracts` now supports a single universal `hardhat-deploy` flow for deploy and upgrade:

- first run on a network deploys `VotingCore` UUPS proxy,
- next runs on the same network compare on-chain implementation bytecode vs current build and upgrade only when changed,
- if nothing changed, script is no-op.

Per-network settings live in YAML files:

- `packages/contracts/deploy-config/polygon.yaml`
- `packages/contracts/deploy-config/arbitrumSepolia.yaml`

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

- `POLYGONSCAN_API_KEY`
- `ARBISCAN_API_KEY`

Web:

```bash
npm run dev -w packages/web
npm run build -w packages/web
npm run test -w packages/web
npm run test:e2e -w packages/web
npm run test:e2e:full
```

CLI:

```bash
npm run test -w packages/cli
node packages/cli/src/index.js proposal:create --help
node packages/cli/src/index.js vote:cast --help
node packages/cli/src/index.js results:read --help
```

## Quality gates

Run from repository root:

```bash
npm run build
npm run lint
npm run test
```