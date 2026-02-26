import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { votingAbi } from "../src/abi";

test.skip(process.env.VITE_USE_MOCK === "true", "Real-contract e2e requires VITE_USE_MOCK=false");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deploymentPath = path.resolve(__dirname, "../../shared/src/deployment.local.json");
const ownerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const adminAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const delegatedWalletKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ownerAddress = privateKeyToAccount(ownerKey).address;
const delegatedWalletAddress = privateKeyToAccount(delegatedWalletKey).address;
const delegationId = "0x1111111111111111111111111111111111111111111111111111111111111111";

function toDateTimeLocalInput(unixTs: number): string {
  const date = new Date(unixTs * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

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

test("frontend pages flow on real contracts", async ({ page }) => {
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
  if (await page.getByTestId("mock-mode-banner").isVisible().catch(() => false)) {
    test.skip(true, "Real-contract e2e is skipped when app is in mock mode.");
  }
  if (!(await page.getByTestId("wallet-status").isVisible().catch(() => false))) {
    const testWalletInput = page.getByTestId("test-wallet-key-input");
    if (await testWalletInput.isVisible().catch(() => false)) {
      await testWalletInput.fill(ownerKey);
      await page.getByTestId("connect-test-wallet").click();
    }
  }
  await expect(page.getByTestId("wallet-status")).toHaveText(/^0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}$/);

  await page.getByTestId("open-create-space-modal").click();
  await page.getByTestId("space-token-input").fill(deployment.token);
  await page.getByTestId("space-name-input").fill("E2E New Space");
  await page.getByTestId("space-description-input").fill("Space created from pages e2e");
  await page.getByTestId("create-space-btn").click();
  await expect(page).toHaveURL(/\/spaces\/\d+$/);

  const createdSpaceIdText = page.url().split("/").at(-1) ?? "0";
  const createdSpaceId = BigInt(createdSpaceIdText);
  expect(createdSpaceId).toBeGreaterThan(0n);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceIdText}/settings$`));
  await page.getByTestId("admin-account-input").fill(adminAddress);
  await page.getByTestId("set-admin-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: setAdmin");
  await page.goto(`/spaces/${createdSpaceIdText}/settings`);
  await page.getByTestId("space-delegation-id-input").fill(delegationId);
  await page.getByTestId("set-space-delegation-id-btn").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: setSpaceDelegationId");

  // Keep e2e deterministic: ensure id is set even if UI toast races.
  const ownerWallet = createWalletClient({
    account: privateKeyToAccount(ownerKey),
    chain,
    transport: http("http://127.0.0.1:8545")
  });
  const ensureDelegationIdTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "setSpaceDelegationId",
    args: [createdSpaceId, delegationId]
  });
  await rpc.waitForTransactionReceipt({ hash: ensureDelegationIdTx });

  const adminOnChain = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "isAdmin",
    args: [createdSpaceId, adminAddress]
  });
  expect(adminOnChain).toBe(true);

  const delegatedWallet = createWalletClient({
    account: privateKeyToAccount(delegatedWalletKey),
    chain,
    transport: http("http://127.0.0.1:8545")
  });
  const registryRead = await rpc.readContract({
    address: deployment.delegateRegistry,
    abi: [
      {
        type: "function",
        name: "delegation",
        stateMutability: "view",
        inputs: [
          { name: "", type: "address" },
          { name: "", type: "bytes32" }
        ],
        outputs: [{ name: "", type: "address" }]
      }
    ],
    functionName: "delegation",
    args: [delegatedWalletAddress, delegationId]
  });
  if (registryRead.toLowerCase() !== ownerAddress.toLowerCase()) {
    const setDelegateTx = await delegatedWallet.writeContract({
      address: deployment.delegateRegistry,
      abi: [
        {
          type: "function",
          name: "setDelegate",
          stateMutability: "nonpayable",
          inputs: [
            { name: "id", type: "bytes32" },
            { name: "delegate", type: "address" }
          ],
          outputs: []
        }
      ],
      functionName: "setDelegate",
      args: [delegationId, ownerAddress]
    });
    await rpc.waitForTransactionReceipt({ hash: setDelegateTx });
  }
  const syncSetTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationForSpace",
    args: [createdSpaceId, delegatedWalletAddress]
  });
  await rpc.waitForTransactionReceipt({ hash: syncSetTx });

  await page.goto(`/spaces/${createdSpaceIdText}`);
  if (!(await page.getByTestId("wallet-status").isVisible().catch(() => false))) {
    const testWalletInputReload = page.getByTestId("test-wallet-key-input");
    if (await testWalletInputReload.isVisible().catch(() => false)) {
      await testWalletInputReload.fill(ownerKey);
      await page.getByTestId("connect-test-wallet").click();
    }
    await expect(page.getByTestId("wallet-status")).toHaveText(/^0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}$/);
  }
  await page.getByRole("button", { name: "Create Proposal" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceIdText}/proposals/new$`));

  const nowTs = Math.floor(Date.now() / 1000);
  await page.getByTestId("proposal-title-input").fill("E2E Proposal From New Page");
  await page.getByTestId("proposal-description-input").fill("Full pages flow proposal");
  await page.getByTestId("proposal-start-input").fill(toDateTimeLocalInput(nowTs - 60));
  await page.getByTestId("proposal-end-input").fill(toDateTimeLocalInput(nowTs + 3600));
  await page.getByTestId("create-proposal-btn").click();

  await expect(page).toHaveURL(/\/proposals\/\d+$/);
  const proposalIdText = page.url().split("/").at(-1) ?? "0";
  const proposalId = BigInt(proposalIdText);
  expect(proposalId).toBeGreaterThan(0n);

  await page.getByTestId("vote-option-0").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: vote");
  await expect(page.getByRole("cell", { name: ownerAddress }).first()).toBeVisible();

  const tallies = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [proposalId]
  });
  expect(tallies[1][0]).toBe(2000n * 10n ** 18n);

  const clearDelegateTx = await delegatedWallet.writeContract({
    address: deployment.delegateRegistry,
    abi: [
      {
        type: "function",
        name: "clearDelegate",
        stateMutability: "nonpayable",
        inputs: [{ name: "id", type: "bytes32" }],
        outputs: []
      }
    ],
    functionName: "clearDelegate",
    args: [delegationId]
  });
  await rpc.waitForTransactionReceipt({ hash: clearDelegateTx });
  const syncClearTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationForSpace",
    args: [createdSpaceId, delegatedWalletAddress]
  });
  await rpc.waitForTransactionReceipt({ hash: syncClearTx });

  await page.goto(`/proposals/${proposalIdText}`);
  await page.getByTestId("vote-option-1").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: vote");

  const talliesAfterClear = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [proposalId]
  });
  expect(talliesAfterClear[1][0]).toBe(0n);
  expect(talliesAfterClear[1][1]).toBe(1000n * 10n ** 18n);

  await page.goto(`/spaces/${createdSpaceIdText}`);
  await page.getByRole("button", { name: "Create Proposal" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${createdSpaceIdText}/proposals/new$`));
  await page.getByTestId("proposal-title-input").fill("E2E Multi Proposal");
  await page.getByTestId("proposal-description-input").fill("Multi-select weighted vote");
  await page.getByTestId("proposal-multiselect-input").check();
  await page.getByTestId("proposal-start-input").fill(toDateTimeLocalInput(nowTs - 60));
  await page.getByTestId("proposal-end-input").fill(toDateTimeLocalInput(nowTs + 3600));
  await page.getByTestId("create-proposal-btn").click();
  await expect(page).toHaveURL(/\/proposals\/\d+$/);
  const multiProposalId = BigInt(page.url().split("/").at(-1) ?? "0");
  expect(multiProposalId).toBeGreaterThan(0n);

  await page.getByTestId("vote-option-check-0").check();
  await page.getByTestId("vote-option-weight-0").fill("1");
  await page.getByTestId("vote-option-check-1").check();
  await page.getByTestId("vote-option-weight-1").fill("3");
  await page.getByTestId("vote-multi-submit").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: vote");

  const multiTallies = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [multiProposalId]
  });
  expect(multiTallies[1][0]).toBeGreaterThan(0n);
  expect(multiTallies[1][1]).toBeGreaterThan(0n);

  assertRuntimeHealthy();
});
