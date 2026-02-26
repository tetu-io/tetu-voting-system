import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/index.js");
const result = spawnSync("node", [cliPath, "--help"], { encoding: "utf8" });

if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(1);
}

if (!result.stdout.includes("tetu-vote")) {
  console.error("CLI help output missing program name");
  process.exit(1);
}

console.log("CLI smoke test passed");
