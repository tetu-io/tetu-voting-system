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

const wagmiSource = read("src/wagmi.ts");
const mainSource = read("src/main.tsx");
const appSource = read("src/App.tsx");

// Guard against the exact regression that caused white screen:
// createConfig(getDefaultConfig(...)) with invalid connector shape.
assert(
  !/createConfig\s*\(\s*getDefaultConfig\s*\(/m.test(wagmiSource),
  "Regression: wagmi.ts must not call createConfig(getDefaultConfig(...))."
);
assert(
  /connectors\s*:\s*\[\s*injected\s*\(\s*\)\s*]/m.test(wagmiSource),
  "wagmi.ts must define injected connector explicitly."
);
assert(
  !wagmiSource.includes("demo-local-project-id"),
  "wagmi.ts must not include demo WalletConnect projectId in local mode."
);

// Guard against reintroducing provider combination that depends on remote appkit config.
assert(
  !mainSource.includes("RainbowKitProvider"),
  "main.tsx must not wrap app with RainbowKitProvider in local mode."
);

// Minimal UX guard for manual smoke: connect CTA should remain visible in fresh state.
assert(
  appSource.includes("Connect Wallet"),
  "App.tsx must expose a connect wallet action in default UI."
);
assert(
  appSource.includes("VITE_USE_MOCK"),
  "App.tsx must support env-driven mock mode toggle."
);
assert(
  appSource.includes("Connect Mock Wallet"),
  "App.tsx must expose mock wallet connect action."
);
assert(
  wagmiSource.includes("VITE_USE_MOCK"),
  "wagmi.ts must be aware of mock mode bootstrap."
);

console.log("Web runtime guards passed");
