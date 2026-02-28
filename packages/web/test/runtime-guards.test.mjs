import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delegateIdTextToBytes32(value) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (/^0x[a-fA-F0-9]{64}$/.test(normalized)) return normalized;
  if (normalized.startsWith("0x")) return null;
  const encoded = new TextEncoder().encode(normalized);
  if (encoded.length > 32) return null;
  const hex = Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${hex.padEnd(64, "0")}`;
}

const wagmiSource = read("src/wagmi.ts");
const mainSource = read("src/main.tsx");
const appSource = read("src/App.tsx");
const realViewsSource = read("src/services/realVotingViews.ts");

// Guard against the exact regression that caused white screen:
// createConfig(getDefaultConfig(...)) with invalid connector shape.
assert(
  !/createConfig\s*\(\s*getDefaultConfig\s*\(/m.test(wagmiSource),
  "Regression: wagmi.ts must not call createConfig(getDefaultConfig(...))."
);
assert(
  wagmiSource.includes("connectorsForWallets"),
  "wagmi.ts must configure connectors via RainbowKit connectorsForWallets."
);
assert(
  wagmiSource.includes("rainbowWallet"),
  "wagmi.ts must configure Rainbow wallet connector."
);
assert(
  wagmiSource.includes("walletConnectWallet"),
  "wagmi.ts must configure WalletConnect connector."
);
assert(
  wagmiSource.includes("VITE_WALLETCONNECT_PROJECT_ID"),
  "wagmi.ts must read WalletConnect project id from env."
);
assert(
  wagmiSource.includes("connectors,"),
  "wagmi.ts must pass RainbowKit connectors into createConfig."
);
assert(
  wagmiSource.includes("getConfiguredChain"),
  "wagmi.ts must resolve chain metadata from chain id."
);
assert(
  !wagmiSource.includes("demo-local-project-id"),
  "wagmi.ts must not include demo WalletConnect projectId in local mode."
);

assert(
  mainSource.includes("RainbowKitProvider"),
  "main.tsx must wrap app with RainbowKitProvider so Connect opens Rainbow modal."
);

// Minimal UX guard for manual smoke: connect CTA should remain visible in fresh state.
assert(
  appSource.includes("Connect"),
  "App.tsx must expose connect action in default UI."
);
assert(
  appSource.includes("Connect wallet to continue"),
  "App.tsx must hard-lock runtime pages behind wallet connect gate in real mode."
);
assert(
  appSource.includes("openConnectModal"),
  "App.tsx must open RainbowKit connect modal on login click."
);
assert(
  appSource.includes("VITE_ENABLE_TEST_WALLET_LOGIN"),
  "App.tsx must hide private key login by default and gate it with env flag."
);
assert(
  appSource.includes("VITE_USE_MOCK"),
  "App.tsx must support env-driven mock mode toggle."
);
assert(
  appSource.includes("delegateIdTextToBytes32"),
  "App.tsx must convert delegation id text into bytes32 before submit."
);
assert(
  appSource.includes("Connect Mock Wallet"),
  "App.tsx must expose mock wallet connect action."
);
assert(
  appSource.includes("useSwitchChain"),
  "App.tsx must use wagmi useSwitchChain to handle wrong network flows."
);
assert(
  appSource.includes("Switch Network"),
  "App.tsx must expose a switch-network CTA when wallet chain is wrong."
);
assert(
  appSource.includes("Wrong network. Switch wallet to"),
  "App.tsx must block write actions when wallet is on wrong chain."
);
assert(
  appSource.includes("chainId: expectedChainId"),
  "App.tsx must enforce expected chain id in writeContract call."
);
assert(
  wagmiSource.includes("VITE_USE_MOCK"),
  "wagmi.ts must be aware of mock mode bootstrap."
);
assert(
  realViewsSource.includes("getSpaceIdsPage"),
  "realVotingViews.ts must use on-chain space pagination getters."
);
assert(
  realViewsSource.includes("getProposalIdsBySpacePage"),
  "realVotingViews.ts must use on-chain proposal pagination getters."
);
assert(
  realViewsSource.includes("getProposalVotersPage"),
  "realVotingViews.ts must use on-chain voters pagination getters."
);
assert(
  !/export\s+async\s+function\s+fetchRealProposalVoters[\s\S]*?getLogs\(/m.test(realViewsSource),
  "fetchRealProposalVoters must not depend on event log scans."
);
assert(
  !/export\s+async\s+function\s+fetchRealProposalsBySpace[\s\S]*?getLogs\(/m.test(realViewsSource),
  "fetchRealProposalsBySpace must not depend on event log scans."
);
assert(
  !/export\s+async\s+function\s+fetchRealSpaces[\s\S]*?getLogs\(/m.test(realViewsSource),
  "fetchRealSpaces must not depend on event log scans."
);
assert(
  !/export\s+async\s+function\s+fetchRealActivityLogs/m.test(realViewsSource),
  "fetchRealActivityLogs should be removed to avoid full historical event-log scans."
);
assert(
  delegateIdTextToBytes32("tetubal.eth") === "0x7465747562616c2e657468000000000000000000000000000000000000000000",
  "delegate id text must encode to expected bytes32 (tetubal.eth sample)."
);

console.log("Web runtime guards passed");
