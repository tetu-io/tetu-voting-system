import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseAbiItem, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { votingAbi } from "../src/abi";

test.skip(process.env.VITE_USE_MOCK === "true", "Real-contract e2e requires VITE_USE_MOCK=false");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deploymentPath = path.resolve(__dirname, "../../shared/src/deployment.local.json");
const ownerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const delegatedWalletKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const delegationId = "0x7465747562616c2e657468000000000000000000000000000000000000000000";

const delegateRegistryAbi = [
  {
    type: "function",
    name: "setDelegate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "delegate", type: "address" }
    ],
    outputs: []
  },
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
] as const;

test("delegated voting power is shown and used for vote", async ({ page }) => {
  const deployment = JSON.parse(await fs.readFile(deploymentPath, "utf8"));
  const chain = defineChain({
    id: deployment.chainId,
    name: "Hardhat Local",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } }
  });
  const rpc = createPublicClient({ chain, transport: http("http://127.0.0.1:8545") });
  const ownerWallet = createWalletClient({
    account: privateKeyToAccount(ownerKey as Hex),
    chain,
    transport: http("http://127.0.0.1:8545")
  });
  const delegatedWallet = createWalletClient({
    account: privateKeyToAccount(delegatedWalletKey as Hex),
    chain,
    transport: http("http://127.0.0.1:8545")
  });
  const ownerAddress = ownerWallet.account.address;
  const delegatedAddress = delegatedWallet.account.address;

  const createSpaceTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "createSpace",
    args: [deployment.token, "Delegation Power E2E", "Power should include unsynced delegations"]
  });
  const createSpaceReceipt = await rpc.waitForTransactionReceipt({ hash: createSpaceTx });
  const [spaceEvent] = parseEventLogs({
    abi: votingAbi,
    logs: createSpaceReceipt.logs,
    eventName: "SpaceCreated"
  });
  const spaceId = spaceEvent.args.spaceId;

  await rpc.waitForTransactionReceipt({
    hash: await ownerWallet.writeContract({
      address: deployment.votingCore,
      abi: votingAbi,
      functionName: "setDelegateRegistry",
      args: [deployment.delegateRegistry]
    })
  });
  await rpc.waitForTransactionReceipt({
    hash: await ownerWallet.writeContract({
      address: deployment.votingCore,
      abi: votingAbi,
      functionName: "setSpaceDelegationId",
      args: [spaceId, delegationId]
    })
  });

  const delegatedTo = await rpc.readContract({
    address: deployment.delegateRegistry,
    abi: delegateRegistryAbi,
    functionName: "delegation",
    args: [delegatedAddress, delegationId]
  });
  if (delegatedTo.toLowerCase() !== ownerAddress.toLowerCase()) {
    await rpc.waitForTransactionReceipt({
      hash: await delegatedWallet.writeContract({
        address: deployment.delegateRegistry,
        abi: delegateRegistryAbi,
        functionName: "setDelegate",
        args: [delegationId, ownerAddress]
      })
    });
  }

  // Intentionally do not call syncDelegationForSpace here:
  // UI should still show delegated power via delegate registry logs.

  const nowTs = Math.floor(Date.now() / 1000);
  const createProposalTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "createProposal",
    args: [
      spaceId,
      "Delegation power e2e proposal",
      "Checks power in UI and vote receipt",
      ["Yes", "No", "Abstain"],
      BigInt(nowTs - 60),
      BigInt(nowTs + 3600),
      true
    ]
  });
  const createProposalReceipt = await rpc.waitForTransactionReceipt({ hash: createProposalTx });
  const [proposalEvent] = parseEventLogs({
    abi: votingAbi,
    logs: createProposalReceipt.logs,
    eventName: "ProposalCreated"
  });
  const proposalId = proposalEvent.args.proposalId;

  await page.goto("/");
  if (!(await page.getByTestId("wallet-status").isVisible().catch(() => false))) {
    const testWalletInput = page.getByTestId("test-wallet-key-input");
    if (await testWalletInput.isVisible().catch(() => false)) {
      await testWalletInput.fill(ownerKey);
      await page.getByTestId("connect-test-wallet").click();
    }
  }
  await expect(page.getByTestId("wallet-status")).toHaveText(/^0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}$/);

  await page.goto(`/proposals/${proposalId.toString()}`);
  await expect(page.getByText(/Your voting power:\s*2000(\.0+)? tokens/)).toBeVisible();

  await page.getByTestId("vote-option-check-0").check();
  await page.getByTestId("vote-option-weight-0").fill("1");
  await page.getByTestId("vote-multi-submit").click();
  await expect(page.getByTestId("status-message")).toContainText("Tx confirmed: vote");

  const receipt = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVoteReceipt",
    args: [proposalId, ownerAddress]
  });
  expect(receipt.weight).toBe(2000n * 10n ** 18n);
});
