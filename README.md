# tetu-voting-system

Simplified Snapshot-like voting system (v1) with:
- UUPS-upgradeable Solidity contracts,
- React web app with Rainbow wallet integration,
- Node CLI for proposal/vote/results flows,
- local-first Hardhat setup.

## Monorepo layout

- `packages/contracts` - Hardhat contracts, deploy/seed/upgrade scripts, contract tests
- `packages/web` - React + Vite UI (RainbowKit + wagmi)
- `packages/cli` - CLI commands (`proposal:create`, `vote:cast`, `results:read`)
- `packages/shared` - shared types and generated local deployment artifacts

## Environment

Copy `.env.example` to `.env` and adjust values when needed.

Key variables:
- `VITE_RPC_URL`
- `VITE_CHAIN_ID`
- `VITE_VOTING_CONTRACT`
- `CLI_RPC_URL`
- `CLI_CONTRACT`

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

## Package scripts

Contracts:

```bash
npm run build -w packages/contracts
npm run test -w packages/contracts
npm run deploy:local -w packages/contracts
npm run seed:local -w packages/contracts
npm run upgrade:smoke -w packages/contracts
```

Web:

```bash
npm run dev -w packages/web
npm run build -w packages/web
npm run test -w packages/web
npm run test:e2e -w packages/web
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