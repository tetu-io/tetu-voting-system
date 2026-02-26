import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const deploymentPath = path.join(rootDir, "packages", "shared", "src", "deployment.local.json");
const hardhatDefaultKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function run(command, args, waitForExit = true, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      cwd: rootDir,
      env
    });
    if (!waitForExit) {
      resolve(child);
      return;
    }
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(child);
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function main() {
  const node = await run("npm", ["run", "node", "-w", "packages/contracts"], false);
  let web = null;

  const cleanup = () => {
    if (web) web.kill("SIGTERM");
    node.kill("SIGTERM");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);

  await new Promise((r) => setTimeout(r, 3000));
  await run("npm", ["run", "deploy:local", "-w", "packages/contracts"]);
  await run("npm", ["run", "seed:local", "-w", "packages/contracts"]);

  const deployment = JSON.parse(await fs.readFile(deploymentPath, "utf8"));
  const webEnv = {
    ...process.env,
    VITE_RPC_URL: "http://127.0.0.1:8545",
    VITE_CHAIN_ID: String(deployment.chainId),
    VITE_VOTING_CONTRACT: deployment.votingCore,
    VITE_TEST_PRIVATE_KEY: hardhatDefaultKey
  };

  web = await run(
    "npm",
    ["run", "dev", "-w", "packages/web", "--", "--host", "127.0.0.1", "--port", "4173"],
    false,
    webEnv
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
