import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { votingAbi } from "../src/abi";

test.skip(process.env.VITE_USE_MOCK === "true", "Real-contract e2e requires VITE_USE_MOCK=false");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deploymentPath = path.resolve(__dirname, "../../shared/src/deployment.local.json");
const ownerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const delegationId = "0x2222222222222222222222222222222222222222222222222222222222222222";

const alphaKey = "0x1000000000000000000000000000000000000000000000000000000000000001";
const betaKey = "0x2000000000000000000000000000000000000000000000000000000000000002";
const gammaKey = "0x3000000000000000000000000000000000000000000000000000000000000003";
const deltaKey = "0x4000000000000000000000000000000000000000000000000000000000000004";

const oneToken = 10n ** 18n;
const tokenAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

const delegateRegistryAbi = [
  {
    type: "function",
    name: "delegation",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "bytes32" }
    ],
    outputs: [{ name: "", type: "address" }]
  },
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
    name: "clearDelegate",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: []
  }
] as const;

function distribute(totalWeight: bigint, weightsBps: number[]): bigint[] {
  let allocatedWeight = 0n;
  return weightsBps.map((weightBps, idx) => {
    if (idx === weightsBps.length - 1) {
      return totalWeight - allocatedWeight;
    }
    const value = (totalWeight * BigInt(weightBps)) / 10000n;
    allocatedWeight += value;
    return value;
  });
}

async function expectWriteRevert(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  let reverted = false;
  try {
    await action();
  } catch (error) {
    reverted = true;
    expect(String(error)).toContain(expectedMessage);
  }
  expect(reverted).toBe(true);
}

test("delegation weight transfers, multi-voter flow and recast stay consistent", async ({ page }) => {
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
  const alphaWallet = createWalletClient({
    account: privateKeyToAccount(alphaKey as Hex),
    chain,
    transport: http("http://127.0.0.1:8545")
  });
  const betaWallet = createWalletClient({
    account: privateKeyToAccount(betaKey as Hex),
    chain,
    transport: http("http://127.0.0.1:8545")
  });
  const gammaWallet = createWalletClient({
    account: privateKeyToAccount(gammaKey as Hex),
    chain,
    transport: http("http://127.0.0.1:8545")
  });
  const deltaWallet = createWalletClient({
    account: privateKeyToAccount(deltaKey as Hex),
    chain,
    transport: http("http://127.0.0.1:8545")
  });

  const alpha = alphaWallet.account.address;
  const beta = betaWallet.account.address;
  const gamma = gammaWallet.account.address;
  const delta = deltaWallet.account.address;

  const ensureDelegate = async (delegatorWallet: typeof alphaWallet, delegate: `0x${string}`): Promise<void> => {
    const currentDelegate = await rpc.readContract({
      address: deployment.delegateRegistry,
      abi: delegateRegistryAbi,
      functionName: "delegation",
      args: [delegatorWallet.account.address, delegationId]
    });
    if (currentDelegate.toLowerCase() === delegate.toLowerCase()) return;
    const setDelegateTx = await delegatorWallet.writeContract({
      address: deployment.delegateRegistry,
      abi: delegateRegistryAbi,
      functionName: "setDelegate",
      args: [delegationId, delegate]
    });
    await rpc.waitForTransactionReceipt({ hash: setDelegateTx });
  };

  const ensureClearedDelegate = async (delegatorWallet: typeof alphaWallet): Promise<void> => {
    const currentDelegate = await rpc.readContract({
      address: deployment.delegateRegistry,
      abi: delegateRegistryAbi,
      functionName: "delegation",
      args: [delegatorWallet.account.address, delegationId]
    });
    if (currentDelegate === "0x0000000000000000000000000000000000000000") return;
    const clearDelegateTx = await delegatorWallet.writeContract({
      address: deployment.delegateRegistry,
      abi: delegateRegistryAbi,
      functionName: "clearDelegate",
      args: [delegationId]
    });
    await rpc.waitForTransactionReceipt({ hash: clearDelegateTx });
  };

  await page.goto("/");
  if (await page.getByTestId("mock-mode-banner").isVisible().catch(() => false)) {
    test.skip(true, "Real-contract e2e is skipped when app is in mock mode.");
  }

  for (const address of [alpha, beta, gamma, delta]) {
    const fundTx = await ownerWallet.sendTransaction({ to: address, value: oneToken });
    await rpc.waitForTransactionReceipt({ hash: fundTx });
  }

  for (const [address, amount] of [
    [alpha, 150n * oneToken],
    [beta, 200n * oneToken],
    [gamma, 120n * oneToken],
    [delta, 80n * oneToken]
  ] as const) {
    const mintTx = await ownerWallet.writeContract({
      address: deployment.token,
      abi: tokenAbi,
      functionName: "mint",
      args: [address, amount]
    });
    await rpc.waitForTransactionReceipt({ hash: mintTx });
  }

  const createSpaceTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "createSpace",
    args: [deployment.token, "Delegation E2E Space", "Complex delegation flow"]
  });
  const createSpaceReceipt = await rpc.waitForTransactionReceipt({ hash: createSpaceTx });
  const [spaceEvent] = parseEventLogs({
    abi: votingAbi,
    logs: createSpaceReceipt.logs,
    eventName: "SpaceCreated"
  });
  const spaceId = spaceEvent.args.spaceId;
  expect(spaceId).toBeGreaterThan(0n);

  const setRegistryTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "setDelegateRegistry",
    args: [deployment.delegateRegistry]
  });
  await rpc.waitForTransactionReceipt({ hash: setRegistryTx });

  const setDelegationIdTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "setSpaceDelegationId",
    args: [spaceId, delegationId]
  });
  await rpc.waitForTransactionReceipt({ hash: setDelegationIdTx });

  await ensureDelegate(deltaWallet, beta);

  const syncInitialDelegationsTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationsForSpace",
    args: [spaceId, [delta]]
  });
  await rpc.waitForTransactionReceipt({ hash: syncInitialDelegationsTx });

  const alphaBalance = await rpc.readContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [alpha]
  });
  const betaBalance = await rpc.readContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [beta]
  });
  const gammaBalance = await rpc.readContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [gamma]
  });
  const deltaBalance = await rpc.readContract({
    address: deployment.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [delta]
  });

  const alphaPowerInitial = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, alpha]
  });
  const betaPowerInitial = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, beta]
  });
  const gammaPowerInitial = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, gamma]
  });
  const deltaPowerInitial = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, delta]
  });
  expect(alphaPowerInitial).toBe(alphaBalance);
  expect(deltaPowerInitial).toBe(0n);
  expect(betaPowerInitial).toBe(betaBalance + deltaBalance);
  expect(gammaPowerInitial).toBe(gammaBalance);

  const nowTs = Math.floor(Date.now() / 1000);
  const createSingleChoiceProposalTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "createProposal",
    args: [
      spaceId,
      "Delegation single-choice proposal",
      "complex scenario",
      ["Yes", "No", "Abstain"],
      BigInt(nowTs - 60),
      BigInt(nowTs + 3600),
      false
    ]
  });
  const createSingleChoiceProposalReceipt = await rpc.waitForTransactionReceipt({
    hash: createSingleChoiceProposalTx
  });
  const [singleProposalEvent] = parseEventLogs({
    abi: votingAbi,
    logs: createSingleChoiceProposalReceipt.logs,
    eventName: "ProposalCreated"
  });
  const singleProposalId = singleProposalEvent.args.proposalId;

  const alphaVoteBeforeDelegatingTx = await alphaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [0], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: alphaVoteBeforeDelegatingTx });

  await ensureDelegate(alphaWallet, beta);
  const syncAlphaAfterVoteTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationForSpace",
    args: [spaceId, alpha]
  });
  await rpc.waitForTransactionReceipt({ hash: syncAlphaAfterVoteTx });

  await expectWriteRevert(
    () =>
      betaWallet.writeContract({
        address: deployment.votingCore,
        abi: votingAbi,
        functionName: "vote",
        args: [singleProposalId, [1], [10000]]
      }),
    "WeightAlreadyClaimed"
  );

  await ensureClearedDelegate(alphaWallet);
  const syncAlphaClearForBetaVoteTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationForSpace",
    args: [spaceId, alpha]
  });
  await rpc.waitForTransactionReceipt({ hash: syncAlphaClearForBetaVoteTx });

  const alphaRecastAwayTx = await alphaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [2], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: alphaRecastAwayTx });

  const betaVoteTx = await betaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [0], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: betaVoteTx });
  const gammaVoteTx = await gammaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [1], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: gammaVoteTx });

  let [, tallies] = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [singleProposalId]
  });
  expect(tallies[0]).toBe(betaPowerInitial);
  expect(tallies[1]).toBe(gammaPowerInitial);
  expect(tallies[2]).toBe(alphaPowerInitial);

  const betaRecastToAbstainTx = await betaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [2], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: betaRecastToAbstainTx });
  [, tallies] = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [singleProposalId]
  });
  expect(tallies[0]).toBe(0n);
  expect(tallies[1]).toBe(gammaPowerInitial);
  expect(tallies[2]).toBe(alphaPowerInitial + betaPowerInitial);

  await ensureDelegate(deltaWallet, gamma);

  const betaPowerWithoutDeltaSync = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, beta]
  });
  const gammaPowerWithoutDeltaSync = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, gamma]
  });
  expect(betaPowerWithoutDeltaSync).toBe(betaBalance);
  expect(gammaPowerWithoutDeltaSync).toBe(gammaBalance);

  const syncDeltaTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationForSpace",
    args: [spaceId, delta]
  });
  await rpc.waitForTransactionReceipt({ hash: syncDeltaTx });

  const gammaPowerAfterDeltaSync = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, gamma]
  });
  expect(gammaPowerAfterDeltaSync).toBe(gammaBalance + deltaBalance);

  const betaRecastToYesTx = await betaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [0], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: betaRecastToYesTx });

  const gammaRecastToNoTx = await gammaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [1], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: gammaRecastToNoTx });

  [, tallies] = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [singleProposalId]
  });
  expect(tallies[0]).toBe(betaPowerWithoutDeltaSync);
  expect(tallies[1]).toBe(gammaPowerAfterDeltaSync);
  expect(tallies[2]).toBe(alphaPowerInitial);

  await ensureClearedDelegate(alphaWallet);

  const syncAlphaTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationForSpace",
    args: [spaceId, alpha]
  });
  await rpc.waitForTransactionReceipt({ hash: syncAlphaTx });

  const alphaPowerAfterClear = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, alpha]
  });
  const betaPowerAfterAlphaClear = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, beta]
  });
  expect(alphaPowerAfterClear).toBe(alphaBalance);
  expect(betaPowerAfterAlphaClear).toBe(betaBalance);

  const betaRecastAfterAlphaClearTx = await betaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [0], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: betaRecastAfterAlphaClearTx });

  const alphaVoteAfterClearTx = await alphaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [singleProposalId, [2], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: alphaVoteAfterClearTx });

  [, tallies] = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [singleProposalId]
  });
  expect(tallies[0]).toBe(betaPowerAfterAlphaClear);
  expect(tallies[1]).toBe(gammaPowerAfterDeltaSync);
  expect(tallies[2]).toBe(alphaPowerAfterClear);

  await ensureDelegate(alphaWallet, beta);
  const syncAlphaBackTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "syncDelegationForSpace",
    args: [spaceId, alpha]
  });
  await rpc.waitForTransactionReceipt({ hash: syncAlphaBackTx });

  const betaPowerForMulti = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, beta]
  });
  const gammaPowerForMulti = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getVotingPower",
    args: [spaceId, gamma]
  });
  expect(betaPowerForMulti).toBe(alphaBalance + betaBalance);
  expect(gammaPowerForMulti).toBe(gammaBalance + deltaBalance);

  const createMultiChoiceProposalTx = await ownerWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "createProposal",
    args: [
      spaceId,
      "Delegation multi-choice proposal",
      "multi with recast",
      ["Opt A", "Opt B", "Opt C"],
      BigInt(nowTs - 60),
      BigInt(nowTs + 3600),
      true
    ]
  });
  const createMultiChoiceProposalReceipt = await rpc.waitForTransactionReceipt({
    hash: createMultiChoiceProposalTx
  });
  const [multiProposalEvent] = parseEventLogs({
    abi: votingAbi,
    logs: createMultiChoiceProposalReceipt.logs,
    eventName: "ProposalCreated"
  });
  const multiProposalId = multiProposalEvent.args.proposalId;

  const betaMultiVoteTx = await betaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [multiProposalId, [0, 1], [2500, 7500]]
  });
  await rpc.waitForTransactionReceipt({ hash: betaMultiVoteTx });
  const gammaMultiVoteTx = await gammaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [multiProposalId, [2], [10000]]
  });
  await rpc.waitForTransactionReceipt({ hash: gammaMultiVoteTx });

  await expectWriteRevert(
    () =>
      alphaWallet.writeContract({
        address: deployment.votingCore,
        abi: votingAbi,
        functionName: "vote",
        args: [multiProposalId, [0], [10000]]
      }),
    "NoVotingPower"
  );

  const [betaPart0, betaPart1] = distribute(betaPowerForMulti, [2500, 7500]);
  [, tallies] = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [multiProposalId]
  });
  expect(tallies[0]).toBe(betaPart0);
  expect(tallies[1]).toBe(betaPart1);
  expect(tallies[2]).toBe(gammaPowerForMulti);

  const betaMultiRecastTx = await betaWallet.writeContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "vote",
    args: [multiProposalId, [1, 2], [4000, 6000]]
  });
  await rpc.waitForTransactionReceipt({ hash: betaMultiRecastTx });

  const [betaRecastPart1, betaRecastPart2] = distribute(betaPowerForMulti, [4000, 6000]);
  [, tallies] = await rpc.readContract({
    address: deployment.votingCore,
    abi: votingAbi,
    functionName: "getProposalTallies",
    args: [multiProposalId]
  });
  expect(tallies[0]).toBe(0n);
  expect(tallies[1]).toBe(betaRecastPart1);
  expect(tallies[2]).toBe(gammaPowerForMulti + betaRecastPart2);
});
