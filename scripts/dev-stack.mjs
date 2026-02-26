import { spawn } from "node:child_process";

function run(command, args, waitForExit = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true });
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
  const cleanup = () => node.kill("SIGTERM");
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise((r) => setTimeout(r, 3000));
  await run("npm", ["run", "deploy:local", "-w", "packages/contracts"]);
  await run("npm", ["run", "seed:local", "-w", "packages/contracts"]);
  await run("npm", ["run", "dev", "-w", "packages/web"]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
