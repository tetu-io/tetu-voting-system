import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http } from "viem";
import { votingAbi } from "../src/abi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deploymentPath = path.resolve(__dirname, "../../shared/src/deployment.local.json");
const ownerAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const adminAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const proposerAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function attachRuntimeGuards(page: import("@playwright/test").Page) {
  const pageErrors: string[] = [];
  const criticalConsoleErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("favicon")) return;
    criticalConsoleErrors.push(text);
  });

  return () => {
    expect(pageErrors, `Unexpected page runtime errors:\n${pageErrors.join("\n")}`).toEqual([]);
    expect(
      criticalConsoleErrors,
      `Unexpected console errors:\n${criticalConsoleErrors.join("\n")}`
    ).toEqual([]);
  };
}

test("full frontend e2e on real contracts", async ({ page }) => {
  const assertRuntimeHealthy = attachRuntimeGuards(page);
  const deployment = JSON.parse(await fs.readFile(deploymentPath, "utf8"));
  const chain = defineChain({
    id: deployment.chainId,
    name: "Hardhat Local",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } }
  });
  const rpc = createPublicClient({ chain, transport: http("http://127.0.0.1:8545") });

  await page.goto("/");
  await expect(page.getByTestId("connect-test-wallet")).toBeVisible();
  await page.getByTestId("connect-test-wallet").click();
  await expect(page.getByTestId("wallet-status")).toContainText("Wallet:");

  // 1) Create space through UI.
  await page.getByTestId("space-token-input").fill(deployment.token);
  await page.getByTestId("space-name-input").fill("E2E Space");
  await page.getByTestId("space-description-input").fill("Space created by Playwright");
  await page.getByTestId("create-space-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Space created:");
  const statusAfterSpace = (await page.getByTestId("status-message").textContent()) ?? "";
  const createdSpaceId = BigInt(statusAfterSpace.split(":").at(-1)?.trim() ?? "0");
  expect(createdSpaceId).toBeGreaterThan(0n);
  const createdSpace = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getSpace",
    args: [createdSpaceId]
  });
  expect(createdSpace.name).toBe("E2E Space");

  // 2) Manage roles through UI.
  await page.getByTestId("space-id-input").fill(createdSpaceId.toString());
  await page.getByTestId("admin-account-input").fill(adminAddress);
  await page.getByTestId("proposer-account-input").fill(proposerAddress);
  await page.getByTestId("set-admin-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: setAdmin");
  await page.getByTestId("set-proposer-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: setProposer");

  const adminOnChain = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "isAdmin",
    args: [createdSpaceId, adminAddress]
  });
  const proposerOnChain = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "isProposer",
    args: [createdSpaceId, proposerAddress]
  });
  expect(adminOnChain).toBe(true);
  expect(proposerOnChain).toBe(true);

  // 3) Create proposal via UI.
  const nowTs = Math.floor(Date.now() / 1000);
  await page.getByTestId("proposal-title-input").fill("E2E Proposal Main");
  await page.getByTestId("proposal-description-input").fill("Main proposal for vote flow");
  await page.getByTestId("proposal-options-input").fill("Alpha,Beta");
  await page.getByTestId("proposal-start-input").fill(String(nowTs - 5));
  await page.getByTestId("proposal-end-input").fill(String(nowTs + 300));
  await page.getByTestId("create-proposal-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Proposal created:");
  const proposalStatus = (await page.getByTestId("status-message").textContent()) ?? "";
  const mainProposalId = BigInt(proposalStatus.split(":").at(-1)?.trim() ?? "0");
  expect(mainProposalId).toBeGreaterThan(0n);

  await page.getByTestId("load-proposals-btn").click();
  await page.getByTestId(`select-proposal-${mainProposalId.toString()}`).click();
  await expect(page.getByTestId("selected-proposal-title")).toContainText(mainProposalId.toString());

  // 4) Vote and re-vote via UI with on-chain checks.
  await page.getByTestId("vote-option-0").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: vote");
  let mainTallies = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [mainProposalId]
  });
  const firstTallies = Array.isArray(mainTallies) ? mainTallies[1] : mainTallies.tallies;
  expect(firstTallies[0]).toBeGreaterThan(0n);
  expect(firstTallies[1]).toBe(0n);

  const firstVoteTxHash = await page.getByTestId("tx-hash").textContent();
  await page.getByTestId("vote-option-1").click();
  await expect(page.getByTestId("tx-hash")).not.toContainText(firstVoteTxHash ?? "");
  mainTallies = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [mainProposalId]
  });
  const recastTallies = Array.isArray(mainTallies) ? mainTallies[1] : mainTallies.tallies;
  expect(recastTallies[1]).toBeGreaterThan(0n);
  expect(recastTallies[0]).toBeLessThan(firstTallies[0]);
  const voteReceipt = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVoteReceipt",
    args: [mainProposalId, ownerAddress]
  });
  expect(voteReceipt.hasVoted).toBe(true);
  expect(voteReceipt.optionIndex).toBe(1);

  // 5) Create short proposal and verify ended rejection from UI.
  const shortNow = Math.floor(Date.now() / 1000);
  await page.getByTestId("proposal-title-input").fill("E2E Proposal Ended");
  await page.getByTestId("proposal-description-input").fill("For ended rejection");
  await page.getByTestId("proposal-options-input").fill("Yes,No");
  await page.getByTestId("proposal-start-input").fill(String(shortNow - 1));
  await page.getByTestId("proposal-end-input").fill(String(shortNow + 1));
  await page.getByTestId("create-proposal-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Proposal created:");
  const endedStatus = (await page.getByTestId("status-message").textContent()) ?? "";
  const endedProposalId = BigInt(endedStatus.split(":").at(-1)?.trim() ?? "0");
  await page.getByTestId("load-proposals-btn").click();
  await page.getByTestId(`select-proposal-${endedProposalId.toString()}`).click();
  await page.waitForTimeout(1500);
  await page.getByTestId("vote-option-0").click();
  await expect(page.getByTestId("status-message")).toContainText("Proposal ended");

  // 6) Delete main proposal via UI and verify on-chain flag.
  await page.getByTestId(`select-proposal-${mainProposalId.toString()}`).click();
  await page.getByTestId("delete-proposal-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: deleteProposal");
  const deletedProposal = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposal",
    args: [mainProposalId]
  });
  expect(deletedProposal.deleted).toBe(true);

  assertRuntimeHealthy();
});
