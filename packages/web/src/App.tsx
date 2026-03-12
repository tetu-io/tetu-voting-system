import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Contract, JsonRpcProvider } from "ethers";
import { createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeEventLog, formatEther, http, parseAbiItem, type Hex, type PublicClient } from "viem";
import { useAccount, useChainId, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { votingAbi } from "./abi";
import logo from "./assets/images/logo.svg";
import {
  Button,
  Card,
  Field,
  FieldLabel,
  IconButton,
  Input,
  Modal,
  Select,
  Slider,
  StatusMessage,
  Table,
  TableWrap,
  Tabs,
  Textarea,
  Tooltip
} from "./components/ui";
import { normalizeError, type EventLikeLog } from "./services/eventText";
import { getChainDisplayName, getConfiguredChain } from "./config/chain";
import { getMockVotingService, type MockVotingViews } from "./services/mockVotingService";
import {
  fetchRealProposalVoters,
  fetchRealProposalsBySpace,
  fetchRealSpaces,
  paginateItems,
  type ProposalVoterView
} from "./services/realVotingViews";
import type { ProposalViewModel, SpaceView, VotingAction, VotingTxResult, WalletAddress } from "./services/votingService";

const contractAddress = (import.meta.env.VITE_VOTING_CONTRACT ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
const eventLogsRpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
const expectedChainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const defaultTestPrivateKey = (import.meta.env.VITE_TEST_PRIVATE_KEY as Hex | undefined) ?? "";
const useMock = import.meta.env.VITE_USE_MOCK === "true";
const enableTestWalletUi = import.meta.env.VITE_ENABLE_TEST_WALLET_LOGIN === "true";
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
const useInternalRpc = useMock || enableTestWalletUi || Boolean(walletConnectProjectId);
const rpcUrl = useInternalRpc ? (import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545") : undefined;
const configuredChain = getConfiguredChain(expectedChainId, rpcUrl);
const expectedChainName = configuredChain.name;
const blockTimeSeconds = Number(import.meta.env.VITE_BLOCK_TIME_SECONDS ?? 12);
const postTxLockBlocks = 10n;
const rpcTimeoutMs = 600_000;
const staticPublicClient = rpcUrl
  ? createPublicClient({
      chain: configuredChain,
      transport: http(rpcUrl, { timeout: rpcTimeoutMs })
    })
  : null;
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
    name: "clearDelegate",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: []
  }
] as const;
const readSpaceAbi = parseAbiItem(
  "function getSpace(uint256 spaceId) view returns ((uint256 id, address token, address owner, string name, string description, bytes32 delegationId))"
);
const erc20SymbolStringAbi = parseAbiItem("function symbol() view returns (string)");
const erc20SymbolBytes32Abi = parseAbiItem("function symbol() view returns (bytes32)");
const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const delegateRegistryEthersAbi = [
  "function delegation(address delegator, bytes32 id) view returns (address)",
  "event SetDelegate(address indexed delegator, bytes32 indexed id, address delegate)",
  "event ClearDelegate(address indexed delegator, bytes32 indexed id)",
  "event ClearDelegate(address indexed delegator, bytes32 indexed id, address indexed delegate)"
] as const;
let cachedDelegateLogsProvider: JsonRpcProvider | null = null;

type RuntimeContext = {
  client: PublicClient;
  eventLogsClient: PublicClient;
  mockService: ReturnType<typeof getMockVotingService> & MockVotingViews;
  effectiveAddress: WalletAddress | null | undefined;
  effectiveConnected: boolean;
  effectiveChainId: number;
  isWrongNetwork: boolean;
  canSwitchNetwork: boolean;
  txPending: boolean;
  switchNetworkPending: boolean;
  statusMessage: string;
  txHash: string | null;
  refreshNonce: number;
  testWalletPrivateKey: string;
  setTestWalletPrivateKey: (value: string) => void;
  testWalletValid: boolean;
  connectMockWallet: (address: WalletAddress) => void;
  disconnectAnyWallet: () => void;
  connectTestWallet: () => void;
  switchToExpectedNetwork: () => Promise<void>;
  executeAction: (action: VotingAction) => Promise<VotingTxResult | null>;
};

type BreadcrumbItem = {
  label: string;
  to?: string;
};

function isWalletAddress(value: string): value is WalletAddress {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isValidPrivateKey(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isBytes32(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function delegateIdTextToBytes32(value: string): `0x${string}` | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (isBytes32(normalized)) return normalized;
  if (normalized.startsWith("0x")) return null;

  const encoded = new TextEncoder().encode(normalized);
  if (encoded.length > 32) return null;

  const hex = Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${hex.padEnd(64, "0")}`;
}

function bytes32ToReadableText(value: `0x${string}`): string | null {
  if (!isBytes32(value)) return null;
  const raw = value.slice(2);
  let text = "";
  for (let i = 0; i < raw.length; i += 2) {
    const byte = Number.parseInt(raw.slice(i, i + 2), 16);
    if (byte === 0) break;
    if (!Number.isFinite(byte) || byte < 32 || byte > 126) return null;
    text += String.fromCharCode(byte);
  }
  return text.length > 0 ? text : null;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function parseDateTimeToUnix(value: string): bigint {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 0n;
  return BigInt(Math.floor(parsed / 1000));
}

function unixToDateTimeLocal(value: bigint): string {
  const date = new Date(Number(value) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function unixToLocalDisplay(value: bigint | null): string {
  if (value === null) return "-";
  return new Date(Number(value) * 1000).toLocaleString();
}

function unixToDateInput(value: bigint): string {
  const date = new Date(Number(value) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toLoggableError(error: unknown): unknown {
  if (!error || typeof error !== "object") return error;

  const value = error as {
    name?: unknown;
    message?: unknown;
    shortMessage?: unknown;
    details?: unknown;
    reason?: unknown;
    data?: unknown;
    cause?: unknown;
    metaMessages?: unknown;
    stack?: unknown;
  };

  const base: Record<string, unknown> = {
    name: value.name,
    message: value.message,
    shortMessage: value.shortMessage,
    details: value.details,
    reason: value.reason,
    data: value.data,
    metaMessages: value.metaMessages,
    stack: value.stack
  };

  if (value.cause && typeof value.cause === "object") {
    base.cause = toLoggableError(value.cause);
  } else if (value.cause !== undefined) {
    base.cause = value.cause;
  }

  return base;
}

function isReceiptPendingError(error: unknown): boolean {
  const text = String(error).toLowerCase();
  return text.includes("transactionreceiptnotfounderror") || text.includes("transaction receipt") && text.includes("could not be found");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeWeightsToBps(weights: number[]): number[] | null {
  const bpsDenominator = 10000;
  if (weights.length === 0) return null;
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) return null;

  const totalWeight = weights.reduce((sum, item) => sum + item, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

  const allocations = weights.map((weight, idx) => {
    const exact = (weight / totalWeight) * bpsDenominator;
    const base = Math.floor(exact);
    return { idx, base, remainder: exact - base };
  });

  let allocated = allocations.reduce((sum, item) => sum + item.base, 0);
  let remainder = bpsDenominator - allocated;
  if (remainder < 0) return null;

  const byLargestRemainder = [...allocations].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.idx - b.idx;
  });

  let pointer = 0;
  while (remainder > 0 && byLargestRemainder.length > 0) {
    byLargestRemainder[pointer].base += 1;
    allocated += 1;
    remainder -= 1;
    pointer = (pointer + 1) % byLargestRemainder.length;
  }

  if (allocated !== bpsDenominator) return null;

  const normalized = [...byLargestRemainder].sort((a, b) => a.idx - b.idx).map((item) => item.base);
  return normalized.every((item) => item > 0) ? normalized : null;
}

async function findBlockAtOrAfter(provider: JsonRpcProvider, targetTs: number): Promise<number> {
  const latestBlockNumber = await provider.getBlockNumber();
  const latestBlock = await provider.getBlock(latestBlockNumber);
  if (!latestBlock) return latestBlockNumber;
  if (latestBlock.timestamp <= targetTs) return latestBlockNumber;

  let low = 0;
  let high = latestBlockNumber;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await provider.getBlock(mid);
    const blockTs = block?.timestamp ?? 0;
    if (blockTs < targetTs) low = mid + 1;
    else high = mid;
  }
  return low;
}

async function findBlockAtOrBefore(provider: JsonRpcProvider, targetTs: number): Promise<number> {
  const latestBlockNumber = await provider.getBlockNumber();
  const latestBlock = await provider.getBlock(latestBlockNumber);
  if (!latestBlock) return 0;
  if (latestBlock.timestamp <= targetTs) return latestBlockNumber;
  const firstAtOrAfter = await findBlockAtOrAfter(provider, targetTs);
  const candidate = Math.max(0, firstAtOrAfter - 1);
  const candidateBlock = await provider.getBlock(candidate);
  if ((candidateBlock?.timestamp ?? 0) <= targetTs) return candidate;
  return 0;
}

async function collectDelegationChangeDelegatorsByBlocks(params: {
  delegateRegistry: WalletAddress;
  delegationId: `0x${string}`;
  fromBlock: number;
  toBlock: number;
  fetchBatchSize: number;
  onProgress?: (message: string) => void;
  onRangeProgress?: (processedBlocks: number, totalBlocks: number) => void;
}): Promise<WalletAddress[]> {
  const { delegateRegistry, delegationId, fromBlock, toBlock, fetchBatchSize, onProgress, onRangeProgress } = params;
  if (toBlock < fromBlock) return [];
  if (!cachedDelegateLogsProvider) {
    cachedDelegateLogsProvider = new JsonRpcProvider(eventLogsRpcUrl, expectedChainId);
  }
  const provider = cachedDelegateLogsProvider;
  const registry = new Contract(delegateRegistry, delegateRegistryEthersAbi, provider);

  async function queryFilterInChunks(
    filter: unknown,
    rangeFrom: number,
    rangeTo: number
  ): Promise<Array<{ blockNumber: number; index: number; args: unknown[]; fragment: { name: string } }>> {
    const minSpan = 5_000;
    const stack: Array<[number, number]> = [[rangeFrom, rangeTo]];
    const all: Array<{ blockNumber: number; index: number; args: unknown[]; fragment: { name: string } }> = [];

    while (stack.length > 0) {
      const [from, to] = stack.pop()!;
      try {
        const logs = (await registry.queryFilter(filter, from, to)) as Array<{
          blockNumber: number;
          index: number;
          args: unknown[];
          fragment: { name: string };
        }>;
        all.push(...logs);
      } catch {
        if (to - from <= minSpan) continue;
        const mid = Math.floor((from + to) / 2);
        stack.push([mid + 1, to], [from, mid]);
      }
    }
    return all;
  }

  async function queryFilterResilient(
    filter: unknown
  ): Promise<Array<{ blockNumber: number; index: number; args: unknown[]; fragment: { name: string } }>> {
    const all: Array<{ blockNumber: number; index: number; args: unknown[]; fragment: { name: string } }> = [];
    const normalizedBatchSize = Math.max(1, fetchBatchSize);
    const totalBlocks = Math.max(1, toBlock - fromBlock + 1);
    let processedBlocks = 0;
    for (let currentFrom = fromBlock; currentFrom <= toBlock; currentFrom += normalizedBatchSize) {
      const currentTo = Math.min(toBlock, currentFrom + normalizedBatchSize - 1);
      onProgress?.(`Fetching logs for blocks ${currentFrom}-${currentTo}...`);
      try {
        const logs = (await registry.queryFilter(filter, currentFrom, currentTo)) as Array<{
          blockNumber: number;
          index: number;
          args: unknown[];
          fragment: { name: string };
        }>;
        all.push(...logs);
        onProgress?.(`Fetched ${logs.length} logs for blocks ${currentFrom}-${currentTo}.`);
      } catch {
        onProgress?.(`Direct fetch failed for ${currentFrom}-${currentTo}, using fallback splitting...`);
        const logs = await queryFilterInChunks(filter, currentFrom, currentTo);
        all.push(...logs);
        onProgress?.(`Fetched ${logs.length} logs via fallback for blocks ${currentFrom}-${currentTo}.`);
      }
      processedBlocks = Math.min(totalBlocks, processedBlocks + (currentTo - currentFrom + 1));
      onRangeProgress?.(processedBlocks, totalBlocks);
    }
    return all;
  }

  const setFilter = registry.filters.SetDelegate(null, delegationId);
  const clearFilters: unknown[] = [];
  try {
    clearFilters.push(registry.filters["ClearDelegate(address,bytes32)"](null, delegationId));
  } catch {
    // Registry may not expose this overload.
  }
  try {
    clearFilters.push(registry.filters["ClearDelegate(address,bytes32,address)"](null, delegationId, null));
  } catch {
    // Registry may not expose this overload.
  }

  const [setLogs, clearLogsByFilter] = await Promise.all([
    queryFilterResilient(setFilter),
    Promise.all(clearFilters.map((filter) => queryFilterResilient(filter).catch(() => [])))
  ]);
  const clearLogs = clearLogsByFilter.flat();
  const replay = [...setLogs, ...clearLogs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return (a.index ?? 0) - (b.index ?? 0);
  });
  const uniqueDelegators = new Set<string>();
  for (const log of replay) {
    uniqueDelegators.add(String(log.args[0]).toLowerCase());
  }
  return [...uniqueDelegators] as WalletAddress[];
}

async function findOutdatedDelegators(params: {
  client: PublicClient;
  delegateRegistry: WalletAddress;
  delegationId: `0x${string}`;
  spaceId: bigint;
  delegators: WalletAddress[];
}): Promise<WalletAddress[]> {
  const { client, delegateRegistry, delegationId, spaceId, delegators } = params;
  if (delegators.length === 0) return [];
  if (!cachedDelegateLogsProvider) {
    cachedDelegateLogsProvider = new JsonRpcProvider(eventLogsRpcUrl, expectedChainId);
  }
  const registryContract = new Contract(delegateRegistry, delegateRegistryEthersAbi, cachedDelegateLogsProvider!);

  const results = await Promise.all(
    delegators.map(async (delegator) => {
      const [registryDelegate, indexedDelegate] = await Promise.all([
        registryContract.delegation(delegator, delegationId) as Promise<string>,
        client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getSpaceDelegate",
          args: [spaceId, delegator]
        })
      ]);
      return registryDelegate.toLowerCase() !== String(indexedDelegate).toLowerCase() ? delegator : null;
    })
  );

  return results.filter((item): item is WalletAddress => item !== null);
}

function useVotingRuntime(): RuntimeContext {
  const mockService = useMemo(() => getMockVotingService(expectedChainId) as ReturnType<typeof getMockVotingService> & MockVotingViews, []);
  const { address, isConnected, chainId: accountChainId } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const wagmiPublicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: switchNetworkPending } = useSwitchChain();

  const [txPending, setTxPending] = useState(false);
  const txPendingRef = useRef(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [testWalletPrivateKey, setTestWalletPrivateKey] = useState(defaultTestPrivateKey);
  const [testWalletConnected, setTestWalletConnected] = useState(Boolean(defaultTestPrivateKey));
  const fallbackPublicClient = useMemo(
    () =>
      createPublicClient({
        chain: configuredChain,
        transport: http(undefined, { timeout: rpcTimeoutMs })
      }),
    []
  );
  const eventLogsClient = useMemo(
    () =>
      createPublicClient({
        chain: getConfiguredChain(expectedChainId, eventLogsRpcUrl),
        transport: http(eventLogsRpcUrl, { timeout: rpcTimeoutMs })
      }),
    []
  );

  const testWalletClient = useMemo(() => {
    if (!enableTestWalletUi || !rpcUrl) return null;
    if (!isValidPrivateKey(testWalletPrivateKey)) return null;
    return createWalletClient({
      account: privateKeyToAccount(testWalletPrivateKey),
      chain: configuredChain,
      transport: http(rpcUrl, { timeout: rpcTimeoutMs })
    });
  }, [testWalletPrivateKey]);

  const usingTestWallet = !useMock && testWalletConnected && testWalletClient !== null;
  const connectedChainId = accountChainId ?? chainId;
  const isWrongNetwork = !useMock && isConnected && !usingTestWallet && connectedChainId !== expectedChainId;
  const canSwitchNetwork = isWrongNetwork && typeof switchChainAsync === "function";
  const client = wagmiPublicClient ?? staticPublicClient ?? fallbackPublicClient;
  const mockConnectedAddress = useMock ? mockService.getConnectedAddress() : null;
  const effectiveAddress = useMock ? mockConnectedAddress : usingTestWallet ? testWalletClient.account.address : address;
  const effectiveConnected = useMock ? Boolean(mockConnectedAddress) : isConnected || usingTestWallet;
  const effectiveChainId = useMock ? mockService.getChainId() : usingTestWallet ? expectedChainId : connectedChainId;

  async function switchToExpectedNetwork() {
    if (!canSwitchNetwork || !switchChainAsync) return;
    setStatusMessage(`Requesting wallet network switch to ${expectedChainName} (${expectedChainId})...`);
    try {
      await switchChainAsync({ chainId: expectedChainId });
      setStatusMessage(`Switched to ${expectedChainName} (${expectedChainId}).`);
    } catch (error) {
      setStatusMessage(normalizeError(error));
    }
  }

  async function executeAction(action: VotingAction): Promise<VotingTxResult | null> {
    if (txPendingRef.current) {
      setStatusMessage("Another transaction is already in progress. Wait for confirmation.");
      return null;
    }
    if (!effectiveConnected) {
      setStatusMessage("Connect wallet first");
      return null;
    }
    if (isWrongNetwork) {
      setStatusMessage(`Wrong network. Switch wallet to ${expectedChainName} (${expectedChainId}).`);
      return null;
    }
    setStatusMessage(`Confirm "${action.functionName}" transaction in wallet...`);
    setTxHash(null);
    txPendingRef.current = true;
    setTxPending(true);
    const waitForReceipt = async (hash: Hex, step: "main" | "registry") => {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await client.waitForTransactionReceipt({
            hash,
            pollingInterval: 1_500,
            timeout: 360_000
          });
        } catch (error) {
          if (!isReceiptPendingError(error) || attempt >= maxAttempts) throw error;
          const retryInMs = attempt * 4_000;
          const suffix = step === "registry" ? " (delegate registry)" : "";
          setStatusMessage(
            `Tx sent${suffix}. Waiting for confirmation... retry ${attempt}/${maxAttempts - 1}, next check in ${Math.round(retryInMs / 1000)}s.`
          );
          await sleep(retryInMs);
        }
      }
      throw new Error("Transaction receipt is unavailable after multiple retries");
    };
    try {
      if (useMock) {
        setStatusMessage(`Submitting "${action.functionName}"...`);
        const receipt = await mockService.execute(action);
        setTxHash(receipt.hash);
        setStatusMessage(`Tx confirmed: ${action.functionName}`);
        setRefreshNonce((prev) => prev + 1);
        return receipt;
      }

      if (action.functionName === "setDelegateForSpace" || action.functionName === "clearDelegateForSpace") {
        const [spaceId] = action.args;
        const [space, registry] = await Promise.all([
          client.readContract({
            address: contractAddress,
            abi: votingAbi,
            functionName: "getSpace",
            args: [spaceId]
          }),
          client.readContract({
            address: contractAddress,
            abi: votingAbi,
            functionName: "delegateRegistry"
          })
        ]);
        const zeroAddress = "0x0000000000000000000000000000000000000000";
        if (registry === zeroAddress) {
          throw new Error("DelegateRegistryNotSet");
        }
        if (space.delegationId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
          throw new Error("DelegationIdNotSet");
        }
        const registryHash =
          action.functionName === "setDelegateForSpace"
            ? usingTestWallet
              ? await testWalletClient!.writeContract({
                  address: registry,
                  abi: delegateRegistryAbi,
                  functionName: "setDelegate",
                  args: [space.delegationId, action.args[1]]
                })
              : await writeContractAsync({
                  address: registry,
                  abi: delegateRegistryAbi,
                  functionName: "setDelegate",
                  args: [space.delegationId, action.args[1]],
                  chainId: expectedChainId
                })
            : usingTestWallet
              ? await testWalletClient!.writeContract({
                  address: registry,
                  abi: delegateRegistryAbi,
                  functionName: "clearDelegate",
                  args: [space.delegationId]
                })
              : await writeContractAsync({
                  address: registry,
                  abi: delegateRegistryAbi,
                  functionName: "clearDelegate",
                  args: [space.delegationId],
                  chainId: expectedChainId
                });
        const registryReceipt = await waitForReceipt(registryHash, "registry");
        if (registryReceipt.status !== "success") {
          throw new Error(`Transaction reverted: ${action.functionName} (registry)`);
        }
      }

      const hash = usingTestWallet
        ? await testWalletClient!.writeContract({
            address: contractAddress,
            abi: votingAbi,
            functionName: action.functionName,
            args: action.args
          })
        : await writeContractAsync({
            address: contractAddress,
            abi: votingAbi,
            functionName: action.functionName,
            args: action.args,
            chainId: expectedChainId
          });

      setTxHash(hash);
      setStatusMessage(`Tx sent. Waiting for confirmation of "${action.functionName}"...`);
      const receipt = await waitForReceipt(hash, "main");
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${action.functionName}`);
      }
      const receiptBlock = receipt.blockNumber ?? (await client.getBlockNumber());
      const unlockAtBlock = receiptBlock + postTxLockBlocks;
      let currentBlock = receiptBlock;
      while (currentBlock < unlockAtBlock) {
        const remainingBlocks = unlockAtBlock - currentBlock;
        const blockWord = remainingBlocks === 1n ? "block" : "blocks";
        setStatusMessage(
          `Tx confirmed on-chain. Waiting ${remainingBlocks.toString()} more ${blockWord} before unlocking controls for "${action.functionName}"...`
        );
        const delayMs = Math.max(1_500, Math.round((blockTimeSeconds * 1_000) / 2));
        await sleep(delayMs);
        currentBlock = await client.getBlockNumber();
      }
      const decodedLogs: EventLikeLog[] = [];
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: votingAbi, data: log.data, topics: log.topics }) as EventLikeLog;
          decodedLogs.push(decoded);
        } catch {
          // ignore non-contract logs
        }
      }
      setStatusMessage(`Tx confirmed: ${action.functionName}`);
      setRefreshNonce((prev) => prev + 1);
      return { hash, logs: decodedLogs };
    } catch (error) {
      console.error(`[tx:${action.functionName}] transaction failed`, {
        contractAddress,
        chainId: expectedChainId,
        action,
        normalizedMessage: normalizeError(error),
        rawError: toLoggableError(error)
      });
      setStatusMessage(normalizeError(error));
      return null;
    } finally {
      txPendingRef.current = false;
      setTxPending(false);
    }
  }

  return {
    client,
    eventLogsClient,
    mockService,
    effectiveAddress,
    effectiveConnected,
    effectiveChainId,
    isWrongNetwork,
    canSwitchNetwork,
    txPending,
    switchNetworkPending,
    statusMessage,
    txHash,
    refreshNonce,
    testWalletPrivateKey,
    setTestWalletPrivateKey,
    testWalletValid: testWalletClient !== null,
    connectMockWallet: (selectedAddress: WalletAddress) => {
      mockService.connect(selectedAddress);
      setRefreshNonce((prev) => prev + 1);
    },
    disconnectAnyWallet: () => {
      setTestWalletConnected(false);
      if (useMock) {
        mockService.disconnect();
        setRefreshNonce((prev) => prev + 1);
        return;
      }
      if (isConnected) disconnect();
    },
    connectTestWallet: () => {
      if (testWalletClient) setTestWalletConnected(true);
    },
    switchToExpectedNetwork,
    executeAction
  };
}

function Header({ runtime }: { runtime: RuntimeContext }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mockSelect, setMockSelect] = useState<WalletAddress>(runtime.mockService.getAccounts()[0]);
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    if (!runtime.effectiveConnected) setMenuOpen(false);
  }, [runtime.effectiveConnected]);

  return (
    <Card className="app-nav">
      <header className="row-between">
        <Link to="/" className="app-brand" style={{ textDecoration: "none" }}>
          <img src={logo} alt="Tetu logo" className="app-brand__logo" />
        </Link>

        <div className="row">
          {!runtime.effectiveConnected && useMock && (
            <>
              <Select data-testid="mock-wallet-select" value={mockSelect} onChange={(e) => setMockSelect(e.target.value as WalletAddress)}>
                {runtime.mockService.getAccounts().map((account) => (
                  <option key={account} value={account}>
                    {account}
                  </option>
                ))}
              </Select>
              <Button data-testid="connect-mock-wallet" variant="primary" onClick={() => runtime.connectMockWallet(mockSelect)}>
                Connect Mock Wallet
              </Button>
            </>
          )}

          {!runtime.effectiveConnected && !useMock && (
            <>
              <Button data-testid="connect-wallet" variant="primary" onClick={() => openConnectModal?.()}>
                Connect
              </Button>
            </>
          )}

          {runtime.effectiveConnected && runtime.effectiveAddress && (
            <div style={{ position: "relative" }} className="row">
              <Button
                data-testid="wallet-status"
                variant="secondary"
                size="sm"
                aria-label="menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                {shortAddress(runtime.effectiveAddress)}
              </Button>
              {menuOpen && (
                <Card surface="dark" style={{ position: "absolute", top: 44, right: 0, minWidth: 230, zIndex: 5 }}>
                  <p className="text__paragraph" style={{ marginTop: 0 }}>
                    Connected: {shortAddress(runtime.effectiveAddress)}
                  </p>
                  <Button data-testid="disconnect-wallet" size="sm" onClick={runtime.disconnectAnyWallet}>
                    Logout
                  </Button>
                </Card>
              )}
            </div>
          )}
        </div>
      </header>
    </Card>
  );
}

function WalletConnectGate({ runtime }: { runtime: RuntimeContext }) {
  const { openConnectModal } = useConnectModal();

  return (
    <Card data-testid="wallet-connect-gate" className="stack-4">
      <h2 className="text__title2" style={{ margin: 0 }}>
        Connect wallet to continue
      </h2>
      <p className="text__paragraph" style={{ margin: 0 }}>
        Frontend is locked until wallet connection is established on chain {expectedChainName} ({expectedChainId}).
      </p>
      <div className="row">
        <Button data-testid="wallet-connect-gate-btn" variant="primary" onClick={() => openConnectModal?.()}>
          Connect Wallet
        </Button>
      </div>
      {enableTestWalletUi && (
        <>
          <Field>
            <FieldLabel>Test private key (local/e2e)</FieldLabel>
            <Input
              data-testid="test-wallet-key-input"
              placeholder="0x... private key for local test wallet"
              value={runtime.testWalletPrivateKey}
              onChange={(e) => runtime.setTestWalletPrivateKey(e.target.value)}
            />
          </Field>
          {runtime.testWalletValid ? (
            <Button data-testid="connect-test-wallet" onClick={runtime.connectTestWallet}>
              Login (test key)
            </Button>
          ) : (
            <span data-testid="invalid-test-wallet-key" className="warning text__paragraph">
              Invalid test private key format
            </span>
          )}
        </>
      )}
    </Card>
  );
}

function detectStatusTone(message: string): "info" | "success" | "warning" | "error" {
  if (!message) return "info";
  const lowered = message.toLowerCase();
  if (lowered.includes("tx confirmed")) return "success";
  if (lowered.includes("wrong network")) return "warning";
  if (lowered.includes("error") || lowered.includes("revert") || lowered.includes("invalid")) return "error";
  return "info";
}

type ToastKey = "mock" | "chainWarning" | "txProgress" | "status";

type ToastDismissState = Record<ToastKey, boolean>;

function AppLayout({ runtime, children }: { runtime: RuntimeContext; children: ReactNode }) {
  const [dismissedToasts, setDismissedToasts] = useState<ToastDismissState>({
    mock: false,
    chainWarning: false,
    txProgress: false,
    status: false
  });
  const statusTone = detectStatusTone(runtime.statusMessage);
  const showStatusToast = Boolean(runtime.statusMessage) && !dismissedToasts.status;
  const showTxProgressToast = runtime.txPending && !dismissedToasts.txProgress;
  const showConnectGate = !useMock && !runtime.effectiveConnected;

  function dismissToast(key: ToastKey) {
    setDismissedToasts((prev) => ({ ...prev, [key]: true }));
  }

  useEffect(() => {
    if (runtime.isWrongNetwork) {
      setDismissedToasts((prev) => ({ ...prev, chainWarning: false }));
    }
  }, [runtime.isWrongNetwork]);

  useEffect(() => {
    if (runtime.txPending) {
      setDismissedToasts((prev) => ({ ...prev, txProgress: false }));
    }
  }, [runtime.txPending]);

  useEffect(() => {
    if (runtime.statusMessage) {
      setDismissedToasts((prev) => ({ ...prev, status: false }));
    }
  }, [runtime.statusMessage]);

  useEffect(() => {
    if (!showTxProgressToast) return;
    const timerId = window.setTimeout(() => {
      setDismissedToasts((prev) => ({ ...prev, txProgress: true }));
    }, 5000);
    return () => window.clearTimeout(timerId);
  }, [showTxProgressToast]);

  useEffect(() => {
    if (!showStatusToast || statusTone !== "info") return;
    const timerId = window.setTimeout(() => {
      setDismissedToasts((prev) => ({ ...prev, status: true }));
    }, 5000);
    return () => window.clearTimeout(timerId);
  }, [showStatusToast, statusTone, runtime.statusMessage]);

  return (
    <main className="app-shell app-main">
      <Header runtime={runtime} />
      {showConnectGate ? <WalletConnectGate runtime={runtime} /> : children}
      <div className="app-toast-stack" aria-live="polite" aria-atomic="false">
        {useMock && !dismissedToasts.mock && (
          <StatusMessage data-testid="mock-mode-banner" tone="warning" className="app-toast">
            <IconButton aria-label="Close notification" className="app-toast__close" onClick={() => dismissToast("mock")}>
              ×
            </IconButton>
            <div className="app-toast__body">Mock mode enabled (`VITE_USE_MOCK=true`): wallet and contracts are simulated in-memory.</div>
          </StatusMessage>
        )}
        {runtime.isWrongNetwork && !dismissedToasts.chainWarning && (
          <StatusMessage data-testid="chain-warning" tone="warning" className="app-toast">
            <IconButton aria-label="Close notification" className="app-toast__close" onClick={() => dismissToast("chainWarning")}>
              ×
            </IconButton>
            <div className="app-toast__body">
              <Tooltip content="For safety, write actions are blocked until the connected wallet is on the configured chain.">
                <span>
                  Wrong network. Expected {expectedChainName} ({expectedChainId}), current {getChainDisplayName(runtime.effectiveChainId)} (
                  {runtime.effectiveChainId}).
                </span>
              </Tooltip>
              <Button
                data-testid="switch-network-btn"
                size="sm"
                onClick={() => void runtime.switchToExpectedNetwork()}
                disabled={!runtime.canSwitchNetwork || runtime.switchNetworkPending}
              >
                {runtime.switchNetworkPending ? "Switching..." : "Switch Network"}
              </Button>
            </div>
          </StatusMessage>
        )}
        {showTxProgressToast && (
          <StatusMessage data-testid="tx-progress" tone="info" className="app-toast">
            <IconButton aria-label="Close notification" className="app-toast__close" onClick={() => dismissToast("txProgress")}>
              ×
            </IconButton>
            <div className="app-toast__body">Transaction in progress. Controls are locked until confirmation depth reaches +10 blocks.</div>
          </StatusMessage>
        )}
        {showStatusToast && (
          <StatusMessage data-testid="status-message" tone={statusTone} className="app-toast">
            <IconButton aria-label="Close notification" className="app-toast__close" onClick={() => dismissToast("status")}>
              ×
            </IconButton>
            <div className="app-toast__body">{runtime.statusMessage}</div>
          </StatusMessage>
        )}
      </div>
    </main>
  );
}

function ProgressLogList({ entries, testId }: { entries: string[]; testId: string }) {
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries.length]);

  return (
    <ul ref={listRef} className="page-loader__log" data-testid={testId}>
      {entries.map((entry, idx) => (
        <li key={`${idx}-${entry}`} className="text__caption">
          [{idx + 1}] {entry}
        </li>
      ))}
    </ul>
  );
}

function PageNavigation({ backTo, breadcrumbs }: { backTo: string; breadcrumbs: BreadcrumbItem[] }) {
  const navigate = useNavigate();

  return (
    <Card>
      <div className="row-between" style={{ alignItems: "center", flexWrap: "wrap", rowGap: 8 }}>
        <Button size="sm" onClick={() => navigate(backTo)}>
          Back
        </Button>
        <nav aria-label="Breadcrumbs" className="text__paragraph" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <span key={`${crumb.label}-${idx}`} className="row" style={{ gap: 6, alignItems: "center" }}>
                {crumb.to && !isLast ? <Link to={crumb.to}>{crumb.label}</Link> : <span className={isLast ? "muted" : undefined}>{crumb.label}</span>}
                {!isLast && <span className="muted">/</span>}
              </span>
            );
          })}
        </nav>
      </div>
    </Card>
  );
}

function SpacesPage({ runtime }: { runtime: RuntimeContext }) {
  const navigate = useNavigate();
  const [spaces, setSpaces] = useState<SpaceView[]>([]);
  const [tokenSymbols, setTokenSymbols] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [openCreate, setOpenCreate] = useState(false);
  const [token, setToken] = useState("0x0000000000000000000000000000000000000000");
  const [name, setName] = useState("New Space");
  const [description, setDescription] = useState("Created from frontend");
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLog, setLoadingLog] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const appendLoadingLog = (message: string) => {
      if (cancelled) return;
      setLoadingLog((prev) => [...prev, message]);
    };

    async function run() {
      setIsLoading(true);
      setLoadingLog(["Starting spaces load..."]);
      if (useMock) {
        appendLoadingLog("Loading spaces from mock service...");
        const items = runtime.mockService.listSpaces();
        if (!cancelled) setSpaces(items);
        appendLoadingLog(`Spaces loaded (${items.length}).`);
        if (!cancelled) setIsLoading(false);
        return;
      }
      appendLoadingLog("Loading spaces from blockchain...");
      try {
        const items = await fetchRealSpaces(runtime.client, contractAddress, runtime.eventLogsClient);
        if (!cancelled) setSpaces(items);
        appendLoadingLog(`Spaces loaded (${items.length}).`);
      } catch (error) {
        appendLoadingLog(`Loading failed: ${normalizeError(error)}.`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [runtime.client, runtime.eventLogsClient, runtime.mockService, runtime.refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const tokens = [...new Set(spaces.map((space) => space.token.toLowerCase()))] as WalletAddress[];
      if (tokens.length === 0) {
        setTokenSymbols({});
        return;
      }
      const entries = await Promise.all(
        tokens.map(async (tokenAddress) => {
          try {
            const symbol = await runtime.client.readContract({
              address: tokenAddress,
              abi: [erc20SymbolStringAbi],
              functionName: "symbol"
            });
            const cleanSymbol = symbol.trim();
            return [tokenAddress, cleanSymbol.length > 0 ? cleanSymbol : shortAddress(tokenAddress)] as const;
          } catch {
            try {
              const symbolBytes = await runtime.client.readContract({
                address: tokenAddress,
                abi: [erc20SymbolBytes32Abi],
                functionName: "symbol"
              });
              const readable = bytes32ToReadableText(symbolBytes);
              return [tokenAddress, readable ?? shortAddress(tokenAddress)] as const;
            } catch {
              return [tokenAddress, shortAddress(tokenAddress)] as const;
            }
          }
        })
      );
      if (!cancelled) {
        setTokenSymbols(Object.fromEntries(entries));
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [spaces, runtime.client]);

  if (isLoading) {
    return (
      <section className="page-stack">
        <Card className="page-loader">
          <div className="page-loader__spinner" aria-hidden="true" />
          <h2 className="text__title3" style={{ margin: 0 }}>
            Loading spaces
          </h2>
          <p className="text__paragraph muted" style={{ margin: 0 }}>
            Waiting until all required data is loaded.
          </p>
          <div className="page-loader__log-wrap">
            <p className="text__caption muted" style={{ margin: 0 }}>
              Loading log
            </p>
            <ProgressLogList entries={loadingLog} testId="spaces-loading-log" />
          </div>
        </Card>
      </section>
    );
  }

  const paged = paginateItems(spaces, page, 10);

  async function createSpace() {
    if (!isWalletAddress(token)) return;
    const result = await runtime.executeAction({ functionName: "createSpace", args: [token, name, description] });
    if (!result) return;
    setOpenCreate(false);
    const created = result.logs.find((item) => item.eventName === "SpaceCreated");
    const createdId = created?.args?.spaceId;
    if (typeof createdId === "bigint") navigate(`/spaces/${createdId.toString()}`);
  }

  return (
    <section className="page-stack">
      <Card>
        <div className="row-between">
          <h2 className="text__title2" style={{ margin: 0 }}>
            Spaces
          </h2>
          <Button data-testid="open-create-space-modal" variant="primary" onClick={() => setOpenCreate(true)} disabled={runtime.txPending || runtime.isWrongNetwork}>
            Create Space
          </Button>
        </div>
      </Card>

      <Card>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Owner</th>
                <th>Token</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((space) => (
                <tr key={space.id.toString()} onClick={() => navigate(`/spaces/${space.id.toString()}`)} style={{ cursor: "pointer" }}>
                  <td>{space.id.toString()}</td>
                  <td>{space.name}</td>
                  <td>{shortAddress(space.owner)}</td>
                  <td>{tokenSymbols[space.token.toLowerCase()] ?? shortAddress(space.token)}</td>
                </tr>
              ))}
              {paged.items.length === 0 && (
                <tr>
                  <td colSpan={4}>No spaces yet</td>
                </tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
        <Pagination page={paged.page} totalPages={paged.totalPages} setPage={setPage} />
      </Card>

      <Modal open={openCreate} wide onOverlayClick={runtime.txPending || runtime.isWrongNetwork ? undefined : () => setOpenCreate(false)}>
        <div className="stack-3">
          <h3 className="text__title3" style={{ margin: 0 }}>
            Create Space
          </h3>
          <Field>
            <FieldLabel>Token address</FieldLabel>
            <Input
              data-testid="space-token-input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token address"
              disabled={runtime.txPending || runtime.isWrongNetwork}
            />
          </Field>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input data-testid="space-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" disabled={runtime.txPending || runtime.isWrongNetwork} />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              data-testid="space-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
              disabled={runtime.txPending || runtime.isWrongNetwork}
            />
          </Field>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setOpenCreate(false)} disabled={runtime.txPending || runtime.isWrongNetwork}>
              Cancel
            </Button>
            <Button data-testid="create-space-btn" variant="primary" onClick={createSpace} disabled={runtime.txPending || runtime.isWrongNetwork}>
              {runtime.txPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function SpacePage({ runtime }: { runtime: RuntimeContext }) {
  const navigate = useNavigate();
  const { spaceId } = useParams();
  const parsedSpaceId = spaceId && /^\d+$/.test(spaceId) ? BigInt(spaceId) : null;
  const [space, setSpace] = useState<SpaceView | null>(null);
  const [proposals, setProposals] = useState<ProposalViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLog, setLoadingLog] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("proposals");
  const [openDelegateModal, setOpenDelegateModal] = useState(false);
  const [delegateAddress, setDelegateAddress] = useState(zeroAddress);
  const [syncFromDate, setSyncFromDate] = useState("");
  const [syncToDate, setSyncToDate] = useState("");
  const [syncFetchBatchSizeInput, setSyncFetchBatchSizeInput] = useState("1000");
  const [syncSummary, setSyncSummary] = useState("");
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [syncLoadingLog, setSyncLoadingLog] = useState<string[]>([]);
  const [syncDateProgressPct, setSyncDateProgressPct] = useState(0);
  const [syncFoundDelegationsCount, setSyncFoundDelegationsCount] = useState(0);
  const [ownerSyncPeriod, setOwnerSyncPeriod] = useState<{ fromTs: bigint; toTs: bigint }>({ fromTs: 0n, toTs: 0n });
  const resolveOwnerAutoSyncRange = (lastSyncedToTs: bigint) => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const fallbackFromTs = nowTs - BigInt(7 * 24 * 3600);
    return {
      fromTs: lastSyncedToTs > 0n ? lastSyncedToTs : fallbackFromTs,
      toTs: nowTs
    };
  };
  const [canManageSpaceSettings, setCanManageSpaceSettings] = useState(false);

  useEffect(() => {
    if (parsedSpaceId === null) return;
    let cancelled = false;
    const appendLoadingLog = (message: string) => {
      if (cancelled) return;
      setLoadingLog((prev) => [...prev, message]);
    };

    async function run() {
      setIsLoading(true);
      setLoadingLog([`Starting data load for space #${parsedSpaceId.toString()}...`]);
      if (useMock) {
        appendLoadingLog("Loading space details from mock service...");
        const mockSpace = runtime.mockService.getSpace(parsedSpaceId);
        appendLoadingLog("Loading proposals list from mock service...");
        const mockProposals = runtime.mockService.listProposalsBySpace(parsedSpaceId);
        if (!cancelled) {
          setSpace(mockSpace);
          setProposals(mockProposals);
        }
        appendLoadingLog("Space page data is ready.");
        if (!cancelled) setIsLoading(false);
        return;
      }

      appendLoadingLog("Fetching space details from blockchain...");
      const spacePromise = runtime.client.readContract({
        address: contractAddress,
        abi: [readSpaceAbi],
        functionName: "getSpace",
        args: [parsedSpaceId]
      }).then((raw) => {
        appendLoadingLog("Space details loaded.");
        return {
          id: raw.id,
          token: raw.token as WalletAddress,
          owner: raw.owner as WalletAddress,
          name: raw.name,
          description: raw.description,
          delegationId: raw.delegationId as `0x${string}`
        } satisfies SpaceView;
      });

      appendLoadingLog("Fetching proposals for this space...");
      const proposalsPromise = fetchRealProposalsBySpace(runtime.client, contractAddress, parsedSpaceId, runtime.eventLogsClient).then((items) => {
        appendLoadingLog(`Proposals loaded (${items.length}).`);
        return items;
      });

      try {
        const [nextSpace, bySpace] = await Promise.all([spacePromise, proposalsPromise]);
        if (!cancelled) {
          setSpace(nextSpace);
          setProposals(bySpace);
        }
        appendLoadingLog("Space page data is ready.");
      } catch (error) {
        appendLoadingLog(`Loading failed: ${normalizeError(error)}.`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [parsedSpaceId, runtime.client, runtime.eventLogsClient, runtime.mockService, runtime.refreshNonce]);

  useEffect(() => {
    if (!openDelegateModal) return;
    if (parsedSpaceId === null || !space) return;
    let cancelled = false;

    async function run() {
      try {
        let loadedPeriod = { fromTs: 0n, toTs: 0n };
        if (runtime.effectiveAddress) {
          if (useMock) {
            const period = runtime.mockService.getSpaceDelegationSyncPeriod(parsedSpaceId);
            if (!cancelled) {
              setOwnerSyncPeriod(period);
            }
            loadedPeriod = period;
          } else {
            const [indexedDelegate, period] = await Promise.all([
              runtime.client.readContract({
                address: contractAddress,
                abi: votingAbi,
                functionName: "getSpaceDelegate",
                args: [parsedSpaceId, runtime.effectiveAddress]
              }),
              runtime.client.readContract({
                address: contractAddress,
                abi: votingAbi,
                functionName: "getSpaceDelegationSyncPeriod",
                args: [parsedSpaceId]
              })
            ]);
            if (!cancelled) {
              const delegate = String(indexedDelegate).toLowerCase() === zeroAddress ? zeroAddress : (indexedDelegate as WalletAddress);
              setDelegateAddress(delegate);
              setOwnerSyncPeriod({ fromTs: period[0], toTs: period[1] });
            }
            loadedPeriod = { fromTs: period[0], toTs: period[1] };
          }
        }
        if (runtime.effectiveAddress?.toLowerCase() === space.owner.toLowerCase()) {
          const { fromTs, toTs } = resolveOwnerAutoSyncRange(loadedPeriod.toTs);
          if (!cancelled) {
            setSyncFromDate(unixToDateInput(fromTs));
            setSyncToDate(unixToDateInput(toTs));
          }
        }
      } catch {
        // keep modal usable even if reads fail
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [openDelegateModal, parsedSpaceId, runtime.client, runtime.effectiveAddress, runtime.mockService, runtime.refreshNonce, space]);

  useEffect(() => {
    if (parsedSpaceId === null || !space || !runtime.effectiveAddress) {
      setCanManageSpaceSettings(false);
      return;
    }

    let cancelled = false;
    const currentAddress = runtime.effectiveAddress.toLowerCase();
    const ownerAddress = space.owner.toLowerCase();
    if (currentAddress === ownerAddress) {
      setCanManageSpaceSettings(true);
      return;
    }

    async function run() {
      if (useMock) {
        if (!cancelled) setCanManageSpaceSettings(runtime.mockService.isAdmin(parsedSpaceId, runtime.effectiveAddress!));
        return;
      }

      try {
        const isAdmin = await runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "isAdmin",
          args: [parsedSpaceId, runtime.effectiveAddress]
        });
        if (!cancelled) setCanManageSpaceSettings(Boolean(isAdmin));
      } catch {
        if (!cancelled) setCanManageSpaceSettings(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [parsedSpaceId, runtime.client, runtime.effectiveAddress, runtime.mockService, runtime.refreshNonce, space]);

  async function setDelegateForCurrentSpace() {
    if (parsedSpaceId === null) return;
    if (!isWalletAddress(delegateAddress)) return;
    await runtime.executeAction({ functionName: "setDelegateForSpace", args: [parsedSpaceId, delegateAddress] });
  }

  async function clearDelegateForCurrentSpace() {
    if (parsedSpaceId === null) return;
    await runtime.executeAction({ functionName: "clearDelegateForSpace", args: [parsedSpaceId] });
  }

  async function runDelegationSync(fromTs: bigint, toTs: bigint, fetchBatchSize: number) {
    if (parsedSpaceId === null || !space) return;
    if (fromTs > toTs) return;
    if (useMock) {
      setSyncSummary("Delegation log sync is not available in mock mode.");
      return;
    }
    setSyncInProgress(true);
    setSyncSummary("Collecting delegation events...");
    setSyncLoadingLog(["Starting delegation sync..."]);
    setSyncDateProgressPct(0);
    setSyncFoundDelegationsCount(0);
    const appendSyncLog = (message: string) => {
      setSyncLoadingLog((prev) => [...prev, message]);
    };
    try {
      appendSyncLog("Loading delegate registry address...");
      const delegateRegistry = await runtime.client.readContract({
        address: contractAddress,
        abi: votingAbi,
        functionName: "delegateRegistry"
      });
      if (String(delegateRegistry).toLowerCase() === zeroAddress) {
        appendSyncLog("Delegate registry is not configured.");
        setSyncSummary("DelegateRegistry is not configured.");
        return;
      }
      if (space.delegationId.toLowerCase() === zeroBytes32) {
        appendSyncLog("Space delegation id is not set.");
        setSyncSummary("Space delegation id is not set.");
        return;
      }

      if (!cachedDelegateLogsProvider) {
        cachedDelegateLogsProvider = new JsonRpcProvider(eventLogsRpcUrl, expectedChainId);
      }
      appendSyncLog("Resolving block range for selected date period...");
      const fromBlock = await findBlockAtOrAfter(cachedDelegateLogsProvider, Number(fromTs));
      const toBlock = await findBlockAtOrBefore(cachedDelegateLogsProvider, Number(toTs));
      appendSyncLog(`Resolved block range: ${fromBlock}-${toBlock}.`);
      const touchedDelegators = await collectDelegationChangeDelegatorsByBlocks({
        delegateRegistry: delegateRegistry as WalletAddress,
        delegationId: space.delegationId,
        fromBlock,
        toBlock,
        fetchBatchSize,
        onProgress: appendSyncLog,
        onRangeProgress: (processedBlocks, totalBlocks) => {
          const pct = Math.round((processedBlocks / totalBlocks) * 100);
          setSyncDateProgressPct(Math.max(0, Math.min(100, pct)));
        }
      });
      setSyncFoundDelegationsCount(touchedDelegators.length);
      let batchSyncComplete = true;
      if (touchedDelegators.length === 0) {
        appendSyncLog("No delegators affected in selected period.");
        setSyncSummary("No delegation events found in the selected period.");
      } else {
        appendSyncLog(`Found ${touchedDelegators.length} delegators affected by events. Checking contract index...`);
        const outdatedDelegators = await findOutdatedDelegators({
          client: runtime.client,
          delegateRegistry: delegateRegistry as WalletAddress,
          delegationId: space.delegationId,
          spaceId: parsedSpaceId,
          delegators: touchedDelegators
        });
        appendSyncLog(`Outdated delegators to sync: ${outdatedDelegators.length}.`);
        const batchSize = 100;
        let syncedCount = 0;
        for (let i = 0; i < outdatedDelegators.length; i += batchSize) {
          const batch = outdatedDelegators.slice(i, i + batchSize);
          appendSyncLog(
            `Submitting sync batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(outdatedDelegators.length / batchSize)} (${batch.length} delegators)...`
          );
          const receipt = await runtime.executeAction({
            functionName: "syncDelegationsForSpace",
            args: [parsedSpaceId, batch]
          });
          if (!receipt) {
            batchSyncComplete = false;
            appendSyncLog("Sync batch failed. Stopping cycle.");
            break;
          }
          syncedCount += batch.length;
          appendSyncLog(`Batch confirmed. Synced ${syncedCount}/${outdatedDelegators.length}.`);
        }
        const checkpointNote = batchSyncComplete
          ? "Cycle completed."
          : "Cycle interrupted before all batches completed. Checkpoint was not updated.";
        setSyncSummary(
          `Period blocks ${fromBlock}-${toBlock} (fetch batch=${fetchBatchSize}): found ${touchedDelegators.length} delegations, outdated ${outdatedDelegators.length}, synced ${syncedCount}. ${checkpointNote}`
        );
      }

      const isSpaceOwner =
        runtime.effectiveAddress !== null && runtime.effectiveAddress !== undefined &&
        runtime.effectiveAddress.toLowerCase() === space.owner.toLowerCase();
      if (isSpaceOwner && batchSyncComplete) {
        appendSyncLog("All sync batches completed. Updating on-chain checkpoint period...");
        const checkpointTx = await runtime.executeAction({
          functionName: "setSpaceDelegationSyncPeriod",
          args: [parsedSpaceId, fromTs, toTs]
        });
        if (checkpointTx) {
          setOwnerSyncPeriod({ fromTs, toTs });
          appendSyncLog("Checkpoint period updated successfully.");
        } else {
          appendSyncLog("Checkpoint update transaction failed.");
        }
      } else if (isSpaceOwner && !batchSyncComplete) {
        appendSyncLog("Checkpoint update skipped because sync cycle did not fully complete.");
      }
      appendSyncLog("Delegation sync finished.");
      setSyncDateProgressPct(100);
    } catch (error) {
      appendSyncLog(`Sync failed: ${normalizeError(error)}`);
      setSyncSummary(`Sync failed: ${normalizeError(error)}`);
    } finally {
      setSyncInProgress(false);
    }
  }

  async function syncDelegationsByDateRange() {
    if (!space) return;
    const isSpaceOwner =
      runtime.effectiveAddress !== null &&
      runtime.effectiveAddress !== undefined &&
      runtime.effectiveAddress.toLowerCase() === space.owner.toLowerCase();
    if (!isSpaceOwner) {
      setSyncSummary("Sync is available only to the space owner.");
      return;
    }

    const range = resolveOwnerAutoSyncRange(ownerSyncPeriod.toTs);
    if (range.fromTs > range.toTs) {
      setSyncSummary("Nothing new to sync yet.");
      return;
    }
    setSyncFromDate(unixToDateInput(range.fromTs));
    setSyncToDate(unixToDateInput(range.toTs));
    const fetchBatchSize = Number.parseInt(syncFetchBatchSizeInput, 10);
    if (!Number.isFinite(fetchBatchSize) || fetchBatchSize <= 0) {
      setSyncSummary("Invalid fetch batch size. Use a positive integer.");
      return;
    }
    await runDelegationSync(range.fromTs, range.toTs, fetchBatchSize);
  }

  if (parsedSpaceId === null) return <p>Invalid space id</p>;
  if (isLoading) {
    return (
      <section className="page-stack">
        <PageNavigation
          backTo="/"
          breadcrumbs={[
            { label: "Spaces", to: "/" },
            { label: `Space #${parsedSpaceId.toString()}` }
          ]}
        />
        <Card className="page-loader">
          <div className="page-loader__spinner" aria-hidden="true" />
          <h2 className="text__title3" style={{ margin: 0 }}>
            Loading space #{parsedSpaceId.toString()}
          </h2>
          <p className="text__paragraph muted" style={{ margin: 0 }}>
            Waiting until all required data is loaded.
          </p>
          <div className="page-loader__log-wrap">
            <p className="text__caption muted" style={{ margin: 0 }}>
              Loading log
            </p>
            <ProgressLogList entries={loadingLog} testId="space-loading-log" />
          </div>
        </Card>
      </section>
    );
  }
  const paged = paginateItems(proposals, page, 10);
  const isSpaceOwner =
    runtime.effectiveAddress !== null &&
    runtime.effectiveAddress !== undefined &&
    space !== null &&
    runtime.effectiveAddress.toLowerCase() === space.owner.toLowerCase();

  return (
    <section className="page-stack">
      <PageNavigation
        backTo="/"
        breadcrumbs={[
          { label: "Spaces", to: "/" },
          { label: `Space #${parsedSpaceId.toString()}` }
        ]}
      />
      <Card>
        <div className="row-between">
          <h2 className="text__title2" style={{ margin: 0 }}>
            Space #{parsedSpaceId.toString()} {space ? `- ${space.name}` : ""}
          </h2>
          <div className="row">
            <Button variant="primary" onClick={() => navigate(`/spaces/${parsedSpaceId.toString()}/proposals/new`)}>
              Create Proposal
            </Button>
            <Button data-testid="open-delegate-modal-btn" onClick={() => setOpenDelegateModal(true)}>
              Delegate
            </Button>
            {canManageSpaceSettings && (
              <Button data-testid="open-space-settings-btn" onClick={() => navigate(`/spaces/${parsedSpaceId.toString()}/settings`)}>
                Settings
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card surface="dark">
        <Tabs
          activeId={activeTab}
          onChange={setActiveTab}
          items={[
            { id: "proposals", label: "Proposals" },
            { id: "about", label: "About space" }
          ]}
        />
        {activeTab === "about" && (
          <div className="stack-2">
            <p className="text__paragraph">{space?.description ?? "Space not found or not loaded"}</p>
            {space && (
              <>
                <p className="text__paragraph" data-testid="space-owner-value" style={{ margin: 0 }}>
                  Owner: {space.owner}
                </p>
                <p className="text__paragraph" data-testid="space-token-value" style={{ margin: 0 }}>
                  Token: {space.token}
                </p>
                <p className="text__paragraph" data-testid="space-delegation-id-value" style={{ margin: 0, wordBreak: "break-all" }}>
                  Delegation ID: {space.delegationId}
                </p>
              </>
            )}
          </div>
        )}
        {activeTab === "proposals" && (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Author</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.items.map((proposal) => {
                    const now = BigInt(Math.floor(Date.now() / 1000));
                    const status = proposal.deleted ? "deleted" : now >= proposal.endAt ? "ended" : "active";
                    return (
                      <tr key={proposal.id.toString()} onClick={() => navigate(`/proposals/${proposal.id.toString()}`)} style={{ cursor: "pointer" }}>
                        <td>{proposal.id.toString()}</td>
                        <td>{proposal.title}</td>
                        <td>{shortAddress(proposal.author)}</td>
                        <td className={status === "active" ? "success" : status === "deleted" ? "error" : "muted"}>{status}</td>
                      </tr>
                    );
                  })}
                  {paged.items.length === 0 && (
                    <tr>
                      <td colSpan={4}>No proposals in this space yet</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={paged.page} totalPages={paged.totalPages} setPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={openDelegateModal} wide onOverlayClick={runtime.txPending || runtime.isWrongNetwork || syncInProgress ? undefined : () => setOpenDelegateModal(false)}>
        <div className="stack-3">
          <h3 className="text__title3" style={{ margin: 0 }}>
            Delegate & Sync
          </h3>
          <Field>
            <FieldLabel>Delegate my voting power to</FieldLabel>
            <Input
              data-testid="space-delegate-address-input"
              value={delegateAddress}
              onChange={(e) => setDelegateAddress(e.target.value)}
              placeholder="0x..."
              disabled={runtime.txPending || runtime.isWrongNetwork || syncInProgress}
            />
          </Field>
          <div className="row">
            <Button
              data-testid="set-space-delegate-btn"
              variant="primary"
              onClick={setDelegateForCurrentSpace}
              disabled={!isWalletAddress(delegateAddress) || runtime.txPending || runtime.isWrongNetwork || syncInProgress}
            >
              {runtime.txPending ? "Submitting..." : "Delegate"}
            </Button>
            <Button
              data-testid="clear-space-delegate-btn"
              onClick={clearDelegateForCurrentSpace}
              disabled={runtime.txPending || runtime.isWrongNetwork || syncInProgress}
            >
              Clear delegate
            </Button>
          </div>

          {isSpaceOwner && (
            <Card surface="dark" className="stack-3">
              <h4 className="text__title4" style={{ margin: 0 }}>
                Sync delegations by date range
              </h4>
              {syncInProgress ? (
                <div className="page-loader">
                  <div className="page-loader__spinner" aria-hidden="true" />
                  <h4 className="text__title4" style={{ margin: 0 }}>
                    Sync in progress
                  </h4>
                  <p className="text__paragraph muted" style={{ margin: 0 }}>
                    Processing delegation logs and applying sync batches.
                  </p>
                  <p className="text__caption" style={{ margin: 0 }} data-testid="delegate-sync-found-count">
                    Found delegations: {syncFoundDelegationsCount}
                  </p>
                  <div style={{ width: "100%" }}>
                    <div className="proposal-result__track" role="img" aria-label={`Date range sync progress ${syncDateProgressPct}%`}>
                      <div className="proposal-result__fill" style={{ width: `${syncDateProgressPct}%` }} />
                    </div>
                    <p className="text__caption muted" style={{ margin: "6px 0 0 0" }} data-testid="delegate-sync-date-progress">
                      Date range progress: {syncDateProgressPct}%
                    </p>
                  </div>
                  <div className="page-loader__log-wrap">
                    <p className="text__caption muted" style={{ margin: 0 }}>
                      Sync log
                    </p>
                    <ProgressLogList entries={syncLoadingLog} testId="delegate-sync-loading-log" />
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field>
                      <FieldLabel>From date</FieldLabel>
                      <Input data-testid="delegate-sync-from-date" type="date" value={syncFromDate} readOnly />
                    </Field>
                    <Field>
                      <FieldLabel>To date</FieldLabel>
                      <Input data-testid="delegate-sync-to-date" type="date" value={syncToDate} readOnly />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel>Event fetch batch size (blocks)</FieldLabel>
                    <Input
                      data-testid="delegate-sync-fetch-batch-size"
                      type="number"
                      min={1}
                      step={1}
                      value={syncFetchBatchSizeInput}
                      onChange={(e) => setSyncFetchBatchSizeInput(e.target.value)}
                      disabled={runtime.txPending || runtime.isWrongNetwork || syncInProgress}
                    />
                  </Field>
                  <div className="row">
                    <Button
                      data-testid="delegate-sync-btn"
                      variant="primary"
                      onClick={syncDelegationsByDateRange}
                      disabled={
                        runtime.txPending ||
                        runtime.isWrongNetwork ||
                        syncInProgress ||
                        !syncFromDate ||
                        !syncToDate ||
                        !Number.isFinite(Number.parseInt(syncFetchBatchSizeInput, 10)) ||
                        Number.parseInt(syncFetchBatchSizeInput, 10) <= 0
                      }
                    >
                      {syncInProgress ? "Syncing..." : "Sync delegations"}
                    </Button>
                  </div>
                </>
              )}
              <p className="text__caption" data-testid="delegate-owner-sync-period">
                Last synced period: {ownerSyncPeriod.fromTs > 0n ? unixToLocalDisplay(ownerSyncPeriod.fromTs) : "-"} to{" "}
                {ownerSyncPeriod.toTs > 0n ? unixToLocalDisplay(ownerSyncPeriod.toTs) : "-"}
              </p>
              {syncSummary && (
                <p className="text__caption" data-testid="delegate-sync-summary">
                  {syncSummary}
                </p>
              )}
            </Card>
          )}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setOpenDelegateModal(false)} disabled={runtime.txPending || runtime.isWrongNetwork || syncInProgress}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function ProposalCreatePage({ runtime }: { runtime: RuntimeContext }) {
  const navigate = useNavigate();
  const { spaceId } = useParams();
  const parsedSpaceId = spaceId && /^\d+$/.test(spaceId) ? BigInt(spaceId) : null;
  const [title, setTitle] = useState("Frontend proposal");
  const [description, setDescription] = useState("Created from page");
  const [options, setOptions] = useState(["Yes", "No"]);
  const [allowMultipleChoices, setAllowMultipleChoices] = useState(false);
  const [startInput, setStartInput] = useState(unixToDateTimeLocal(BigInt(Math.floor(Date.now() / 1000) + 60)));
  const [endInput, setEndInput] = useState(unixToDateTimeLocal(BigInt(Math.floor(Date.now() / 1000) + 3600)));
  const [durationHours, setDurationHours] = useState(1);

  if (parsedSpaceId === null) return <p>Invalid space id</p>;
  const startAt = parseDateTimeToUnix(startInput);
  const endAt = parseDateTimeToUnix(endInput);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const nowBlockApprox = Math.floor(Number(now) / blockTimeSeconds);
  const startBlockApprox = Math.floor(Number(startAt) / blockTimeSeconds);
  const endBlockApprox = Math.floor(Number(endAt) / blockTimeSeconds);

  async function submit() {
    const cleanOptions = options.map((item) => item.trim()).filter(Boolean);
    if (cleanOptions.length < 2) return;
    const result = await runtime.executeAction({
      functionName: "createProposal",
      args: [parsedSpaceId, title, description, cleanOptions, startAt, endAt, allowMultipleChoices]
    });
    if (!result) return;
    const created = result.logs.find((item) => item.eventName === "ProposalCreated");
    const createdId = created?.args?.proposalId;
    if (typeof createdId === "bigint") {
      navigate(`/proposals/${createdId.toString()}`);
      return;
    }
    navigate(`/spaces/${parsedSpaceId.toString()}`);
  }

  function updateDuration(next: number) {
    setDurationHours(next);
    const parsedStart = Date.parse(startInput);
    if (Number.isNaN(parsedStart)) return;
    const updatedEnd = BigInt(Math.floor((parsedStart + next * 3600_000) / 1000));
    setEndInput(unixToDateTimeLocal(updatedEnd));
  }

  return (
    <section className="page-stack">
      <PageNavigation
        backTo={`/spaces/${parsedSpaceId.toString()}`}
        breadcrumbs={[
          { label: "Spaces", to: "/" },
          { label: `Space #${parsedSpaceId.toString()}`, to: `/spaces/${parsedSpaceId.toString()}` },
          { label: "Create proposal" }
        ]}
      />
      <Card>
        <h2 className="text__title2" style={{ marginTop: 0 }}>
          Create Proposal in Space #{parsedSpaceId.toString()}
        </h2>
        <fieldset disabled={runtime.txPending || runtime.isWrongNetwork} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div className="stack-4">
            <Field>
              <FieldLabel>Proposal title</FieldLabel>
              <Input
                data-testid="proposal-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Proposal title"
              />
            </Field>
            <Field>
              <FieldLabel>Proposal text</FieldLabel>
              <Textarea
                data-testid="proposal-description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Proposal text"
                rows={4}
              />
            </Field>
            <label className="ui-checkbox-line text__paragraph">
              <input
                data-testid="proposal-multiselect-input"
                type="checkbox"
                checked={allowMultipleChoices}
                onChange={(e) => setAllowMultipleChoices(e.target.checked)}
              />
              Allow multi-select vote with percentage weights
            </label>

            <Card surface="dark" className="stack-3">
              <h3 className="text__title4" style={{ margin: 0 }}>
                Options
              </h3>
              {options.map((option, idx) => (
                <div key={idx} className="row">
                  <Input
                    value={option}
                    onChange={(e) => {
                      const copy = [...options];
                      copy[idx] = e.target.value;
                      setOptions(copy);
                    }}
                    placeholder={`Option ${idx + 1}`}
                  />
                  <Button
                    variant="error"
                    onClick={() => setOptions((prev) => prev.filter((_, optionIndex) => optionIndex !== idx))}
                    disabled={options.length <= 2 || runtime.txPending}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button onClick={() => setOptions((prev) => [...prev, `Option ${prev.length + 1}`])} disabled={runtime.txPending || runtime.isWrongNetwork}>
                Add option
              </Button>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field>
                <FieldLabel>Start date</FieldLabel>
                <Input data-testid="proposal-start-input" type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>End date</FieldLabel>
                <Input data-testid="proposal-end-input" type="datetime-local" value={endInput} onChange={(e) => setEndInput(e.target.value)} />
              </Field>
            </div>

            <Field>
              <FieldLabel>Quick duration ({durationHours}h)</FieldLabel>
              <Slider min={1} max={168} step={1} value={durationHours} onChange={(e) => updateDuration(Number(e.target.value))} />
            </Field>

            <Card surface="dark">
              <p className="text__paragraph">Unix start/end: {startAt.toString()} / {endAt.toString()}</p>
              <p className="text__paragraph" style={{ marginBottom: 0 }}>
                Approx blocks (by {blockTimeSeconds}s): now {nowBlockApprox}, start {startBlockApprox}, end {endBlockApprox}
              </p>
            </Card>

            <Button data-testid="create-proposal-btn" variant="primary" onClick={submit} disabled={runtime.txPending || runtime.isWrongNetwork}>
              {runtime.txPending ? "Creating..." : "Create Proposal"}
            </Button>
          </div>
        </fieldset>
      </Card>
    </section>
  );
}

function SpaceSettingsPage({ runtime }: { runtime: RuntimeContext }) {
  const { spaceId } = useParams();
  const parsedSpaceId = spaceId && /^\d+$/.test(spaceId) ? BigInt(spaceId) : null;
  const [settingsTab, setSettingsTab] = useState<"admins" | "proposers" | "delegation">("admins");
  const [adminAccount, setAdminAccount] = useState("");
  const [adminAllowed, setAdminAllowed] = useState<"grant" | "revoke">("grant");
  const [spaceAdmins, setSpaceAdmins] = useState<WalletAddress[]>([]);
  const [proposerAccount, setProposerAccount] = useState("");
  const [proposerAllowed, setProposerAllowed] = useState<"grant" | "revoke">("grant");
  const [spaceProposers, setSpaceProposers] = useState<WalletAddress[]>([]);
  const [roleMembersLoading, setRoleMembersLoading] = useState(false);
  const [roleMembersError, setRoleMembersError] = useState<string | null>(null);
  const [delegationIdInput, setDelegationIdInput] = useState("");
  const [permissionsResolved, setPermissionsResolved] = useState(false);
  const [canManageSpaceSettings, setCanManageSpaceSettings] = useState(false);
  const [canManageAdmins, setCanManageAdmins] = useState(false);
  const [canManageProposers, setCanManageProposers] = useState(false);

  useEffect(() => {
    if (parsedSpaceId === null) {
      setPermissionsResolved(true);
      setCanManageSpaceSettings(false);
      setCanManageAdmins(false);
      setCanManageProposers(false);
      return;
    }
    let cancelled = false;
    async function run() {
      if (useMock) {
        const space = runtime.mockService.getSpace(parsedSpaceId);
        if (space) {
          const isOwner =
            runtime.effectiveAddress !== null &&
            runtime.effectiveAddress !== undefined &&
            runtime.effectiveAddress.toLowerCase() === space.owner.toLowerCase();
          const isAdmin = runtime.effectiveAddress ? runtime.mockService.isAdmin(parsedSpaceId, runtime.effectiveAddress) : false;
          if (!cancelled) {
            setDelegationIdInput(bytes32ToReadableText(space.delegationId) ?? space.delegationId);
            setCanManageSpaceSettings(isOwner || isAdmin);
            setCanManageAdmins(isOwner);
            setCanManageProposers(isOwner || isAdmin);
          }
        } else if (!cancelled) {
          setCanManageSpaceSettings(false);
          setCanManageAdmins(false);
          setCanManageProposers(false);
        }
        if (!cancelled) setPermissionsResolved(true);
        return;
      }
      try {
        const space = await runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getSpace",
          args: [parsedSpaceId]
        });
        const isOwner =
          runtime.effectiveAddress !== null &&
          runtime.effectiveAddress !== undefined &&
          runtime.effectiveAddress.toLowerCase() === String(space.owner).toLowerCase();
        const isAdmin =
          !isOwner && runtime.effectiveAddress
            ? await runtime.client.readContract({
                address: contractAddress,
                abi: votingAbi,
                functionName: "isAdmin",
                args: [parsedSpaceId, runtime.effectiveAddress]
              })
            : false;
        if (!cancelled) {
          setDelegationIdInput(bytes32ToReadableText(space.delegationId) ?? space.delegationId);
          setCanManageSpaceSettings(isOwner || Boolean(isAdmin));
          setCanManageAdmins(isOwner);
          setCanManageProposers(isOwner || Boolean(isAdmin));
        }
      } catch {
        if (!cancelled) {
          setCanManageSpaceSettings(false);
          setCanManageAdmins(false);
          setCanManageProposers(false);
        }
      } finally {
        if (!cancelled) setPermissionsResolved(true);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [parsedSpaceId, runtime.client, runtime.effectiveAddress, runtime.mockService, runtime.refreshNonce]);

  useEffect(() => {
    if (parsedSpaceId === null) {
      setSpaceAdmins([]);
      setSpaceProposers([]);
      setRoleMembersError(null);
      setRoleMembersLoading(false);
      return;
    }
    let cancelled = false;
    async function run() {
      setRoleMembersLoading(true);
      setRoleMembersError(null);
      try {
        if (useMock) {
          if (cancelled) return;
          setSpaceAdmins(runtime.mockService.listAdmins(parsedSpaceId));
          setSpaceProposers(runtime.mockService.listProposers(parsedSpaceId));
          return;
        }
        setSpaceAdmins([]);
        setSpaceProposers([]);
      } catch (error) {
        if (!cancelled) {
          setRoleMembersError(normalizeError(error));
          setSpaceAdmins([]);
          setSpaceProposers([]);
        }
      } finally {
        if (!cancelled) setRoleMembersLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [parsedSpaceId, runtime.mockService, runtime.refreshNonce]);

  async function submitAdminRoleUpdate() {
    if (parsedSpaceId === null) return;
    if (!isWalletAddress(adminAccount)) return;
    const result = await runtime.executeAction({
      functionName: "setAdmin",
      args: [parsedSpaceId, adminAccount, adminAllowed === "grant"]
    });
    if (!result) return;
    setAdminAccount("");
  }

  async function removeAdmin(account: WalletAddress) {
    if (parsedSpaceId === null) return;
    await runtime.executeAction({ functionName: "setAdmin", args: [parsedSpaceId, account, false] });
  }

  async function submitProposerRoleUpdate() {
    if (parsedSpaceId === null) return;
    if (!isWalletAddress(proposerAccount)) return;
    const result = await runtime.executeAction({
      functionName: "setProposer",
      args: [parsedSpaceId, proposerAccount, proposerAllowed === "grant"]
    });
    if (!result) return;
    setProposerAccount("");
  }

  async function removeProposer(account: WalletAddress) {
    if (parsedSpaceId === null) return;
    await runtime.executeAction({ functionName: "setProposer", args: [parsedSpaceId, account, false] });
  }

  async function saveDelegationId() {
    if (parsedSpaceId === null) return;
    const delegationId = delegateIdTextToBytes32(delegationIdInput);
    if (!delegationId) return;
    await runtime.executeAction({ functionName: "setSpaceDelegationId", args: [parsedSpaceId, delegationId] });
  }

  if (parsedSpaceId === null) return <p>Invalid space id</p>;
  const delegationIdHex = delegateIdTextToBytes32(delegationIdInput);

  return (
    <section className="page-stack">
      <PageNavigation
        backTo={`/spaces/${parsedSpaceId.toString()}`}
        breadcrumbs={[
          { label: "Spaces", to: "/" },
          { label: `Space #${parsedSpaceId.toString()}`, to: `/spaces/${parsedSpaceId.toString()}` },
          { label: "Settings" }
        ]}
      />
      <Card>
        <h2 className="text__title2" style={{ marginTop: 0 }}>
          Space #{parsedSpaceId.toString()} settings
        </h2>
        {!permissionsResolved ? (
          <p className="text__paragraph" style={{ marginBottom: 0 }}>
            Checking permissions...
          </p>
        ) : !canManageSpaceSettings ? (
          <p className="text__paragraph" style={{ marginBottom: 0 }}>
            You do not have permission to change this space settings.
          </p>
        ) : (
          <fieldset disabled={runtime.txPending || runtime.isWrongNetwork} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <div className="stack-4">
              <Tabs
                activeId={settingsTab}
                onChange={(tab) => setSettingsTab(tab as "admins" | "proposers" | "delegation")}
                items={[
                  { id: "admins", label: "Admins" },
                  { id: "proposers", label: "Proposers" },
                  { id: "delegation", label: "Space delegation" }
                ]}
              />

              {settingsTab === "admins" && (
                <div className="stack-3">
                  <Card surface="dark" className="stack-3">
                    <h3 className="text__title4" style={{ margin: 0 }}>
                      Current admins
                    </h3>
                    {roleMembersLoading ? (
                      <p className="text__paragraph" style={{ margin: 0 }}>
                        Loading admins...
                      </p>
                    ) : roleMembersError ? (
                      <StatusMessage tone="error">{roleMembersError}</StatusMessage>
                    ) : !useMock ? (
                      <p className="text__paragraph" style={{ margin: 0 }}>
                        Current admin members are not enumerable on this network without event logs. Use the address control below to grant or revoke access directly.
                      </p>
                    ) : spaceAdmins.length === 0 ? (
                      <p className="text__paragraph" style={{ margin: 0 }}>
                        No admins assigned yet.
                      </p>
                    ) : (
                      <div className="stack-2">
                        {spaceAdmins.map((account) => (
                          <div key={account} className="row-between">
                            <span className="text__paragraph" style={{ margin: 0 }}>
                              {account}
                            </span>
                            {canManageAdmins && (
                              <Button
                                variant="error"
                                onClick={() => void removeAdmin(account)}
                                disabled={runtime.txPending || runtime.isWrongNetwork}
                                aria-label={`Remove admin ${account}`}
                                title="Remove admin"
                              >
                                ×
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  {canManageAdmins ? (
                    <>
                      <Field>
                        <FieldLabel>Admin address</FieldLabel>
                        <Input
                          data-testid="admin-account-input"
                          value={adminAccount}
                          onChange={(e) => setAdminAccount(e.target.value)}
                          placeholder="0x..."
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Admin action</FieldLabel>
                        <Select
                          data-testid="admin-role-action-select"
                          value={adminAllowed}
                          onChange={(e) => setAdminAllowed(e.target.value as "grant" | "revoke")}
                        >
                          <option value="grant">Grant admin</option>
                          <option value="revoke">Revoke admin</option>
                        </Select>
                      </Field>
                      <Button
                        data-testid="set-admin-btn"
                        variant="primary"
                        onClick={submitAdminRoleUpdate}
                        disabled={!isWalletAddress(adminAccount) || runtime.txPending || runtime.isWrongNetwork}
                      >
                        {runtime.txPending ? "Saving..." : adminAllowed === "grant" ? "Grant Admin" : "Revoke Admin"}
                      </Button>
                    </>
                  ) : (
                    <p className="text__paragraph" style={{ margin: 0 }}>
                      Only the space owner can add or remove admins.
                    </p>
                  )}
                </div>
              )}

              {settingsTab === "proposers" && (
                <div className="stack-3">
                  <Card surface="dark" className="stack-3">
                    <h3 className="text__title4" style={{ margin: 0 }}>
                      Current proposers
                    </h3>
                    {roleMembersLoading ? (
                      <p className="text__paragraph" style={{ margin: 0 }}>
                        Loading proposers...
                      </p>
                    ) : roleMembersError ? (
                      <StatusMessage tone="error">{roleMembersError}</StatusMessage>
                    ) : !useMock ? (
                      <p className="text__paragraph" style={{ margin: 0 }}>
                        Current proposer members are not enumerable on this network without event logs. Use the address control below to grant or revoke access directly.
                      </p>
                    ) : spaceProposers.length === 0 ? (
                      <p className="text__paragraph" style={{ margin: 0 }}>
                        No proposers assigned yet.
                      </p>
                    ) : (
                      <div className="stack-2">
                        {spaceProposers.map((account) => (
                          <div key={account} className="row-between">
                            <span className="text__paragraph" style={{ margin: 0 }}>
                              {account}
                            </span>
                            {canManageProposers && (
                              <Button
                                variant="error"
                                onClick={() => void removeProposer(account)}
                                disabled={runtime.txPending || runtime.isWrongNetwork}
                                aria-label={`Remove proposer ${account}`}
                                title="Remove proposer"
                              >
                                ×
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  {canManageProposers ? (
                    <>
                      <Field>
                        <FieldLabel>Proposer address</FieldLabel>
                        <Input
                          data-testid="proposer-account-input"
                          value={proposerAccount}
                          onChange={(e) => setProposerAccount(e.target.value)}
                          placeholder="0x..."
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Proposer action</FieldLabel>
                        <Select
                          data-testid="proposer-role-action-select"
                          value={proposerAllowed}
                          onChange={(e) => setProposerAllowed(e.target.value as "grant" | "revoke")}
                        >
                          <option value="grant">Grant proposer</option>
                          <option value="revoke">Revoke proposer</option>
                        </Select>
                      </Field>
                      <Button
                        data-testid="set-proposer-btn"
                        variant="primary"
                        onClick={submitProposerRoleUpdate}
                        disabled={!isWalletAddress(proposerAccount) || runtime.txPending || runtime.isWrongNetwork}
                      >
                        {runtime.txPending ? "Saving..." : proposerAllowed === "grant" ? "Grant Proposer" : "Revoke Proposer"}
                      </Button>
                    </>
                  ) : (
                    <p className="text__paragraph" style={{ margin: 0 }}>
                      Only the space owner or an admin can add or remove proposers.
                    </p>
                  )}
                </div>
              )}

              {settingsTab === "delegation" && (
                <div className="stack-3">
                  <Field>
                    <FieldLabel>Space delegation id (text or bytes32)</FieldLabel>
                    <Input
                      data-testid="space-delegation-id-input"
                      value={delegationIdInput}
                      onChange={(e) => setDelegationIdInput(e.target.value)}
                      placeholder="tetubal.eth"
                    />
                  </Field>
                  <p className="text__caption" style={{ marginTop: -8 }}>
                    Encoded bytes32: {delegationIdHex ?? "invalid value (use text up to 32 bytes or full 0x-prefixed bytes32)"}
                  </p>
                  <Button
                    data-testid="set-space-delegation-id-btn"
                    variant="primary"
                    onClick={saveDelegationId}
                    disabled={!delegationIdHex || runtime.txPending || runtime.isWrongNetwork}
                  >
                    {runtime.txPending ? "Saving..." : "Save delegation id"}
                  </Button>
                </div>
              )}
            </div>
          </fieldset>
        )}
      </Card>
    </section>
  );
}

function ProposalPage({ runtime }: { runtime: RuntimeContext }) {
  const { proposalId } = useParams();
  const parsedProposalId = proposalId && /^\d+$/.test(proposalId) ? BigInt(proposalId) : null;
  const [proposal, setProposal] = useState<ProposalViewModel | null>(null);
  const [tallies, setTallies] = useState<readonly [string[], bigint[]] | null>(null);
  const [voters, setVoters] = useState<ProposalVoterView[]>([]);
  const [votingPower, setVotingPower] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLog, setLoadingLog] = useState<string[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<Record<number, boolean>>({});
  const [weightsInput, setWeightsInput] = useState<Record<number, string>>({});
  const [voteActionPending, setVoteActionPending] = useState<"single" | "multi" | "delete" | null>(null);
  const [pendingSingleOptionIndex, setPendingSingleOptionIndex] = useState<number | null>(null);

  useEffect(() => {
    if (parsedProposalId === null) return;
    let cancelled = false;
    const appendLoadingLog = (message: string) => {
      if (cancelled) return;
      setLoadingLog((prev) => [...prev, message]);
    };

    async function run() {
      setIsLoading(true);
      setLoadingLog([`Starting data load for proposal #${parsedProposalId.toString()}...`]);
      if (useMock) {
        appendLoadingLog("Mock mode is enabled; reading proposal state from in-memory service.");
        appendLoadingLog(`Loading proposal #${parsedProposalId.toString()} details from mock service...`);
        const mockProposal = runtime.mockService.getProposal(parsedProposalId);
        if (!cancelled) setProposal(mockProposal);
        appendLoadingLog(
          mockProposal
            ? `Proposal loaded (space #${mockProposal.spaceId.toString()}, options=${mockProposal.options.length}, deleted=${String(mockProposal.deleted)}).`
            : "Proposal was not found in mock service."
        );
        appendLoadingLog(`Loading tallies for proposal #${parsedProposalId.toString()} from mock service...`);
        const mockTallies = runtime.mockService.getProposalTallies(parsedProposalId);
        if (!cancelled) setTallies(mockTallies ? [mockTallies.options, mockTallies.tallies] : null);
        appendLoadingLog(
          mockTallies
            ? `Tallies loaded (options=${mockTallies.options.length}, totalWeight=${mockTallies.tallies.reduce((sum, weight) => sum + weight, 0n).toString()}).`
            : "Tallies are not available for this proposal in mock service."
        );
        appendLoadingLog(`Loading voters list for proposal #${parsedProposalId.toString()} from mock service...`);
        const mockVoters = runtime.mockService.listVotersForProposal(parsedProposalId);
        if (!cancelled) setVoters(mockVoters);
        appendLoadingLog(`Voters list loaded (${mockVoters.length} voter records).`);
        if (mockProposal && runtime.effectiveAddress) {
          appendLoadingLog(`Calculating voting power in mock service for ${runtime.effectiveAddress}...`);
          const mockVotingPower = runtime.mockService.getVotingPower(mockProposal.spaceId, runtime.effectiveAddress);
          if (!cancelled) setVotingPower(mockVotingPower);
          appendLoadingLog(`Voting power loaded from mock service: ${mockVotingPower.toString()}.`);
        } else {
          if (!cancelled) setVotingPower(0n);
          appendLoadingLog(mockProposal ? "Wallet is not connected; voting power is set to 0." : "Voting power skipped because proposal was not found.");
        }
        appendLoadingLog("Proposal page data is ready (mock mode).");
        if (!cancelled) setIsLoading(false);
        return;
      }

      appendLoadingLog("Reading proposal details, tallies, and voter list from blockchain...");
      try {
        const proposalPromise = runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getProposal",
          args: [parsedProposalId]
        }).then((loadedProposal) => {
          appendLoadingLog(
            `Proposal loaded (space #${loadedProposal.spaceId.toString()}, options=${loadedProposal.options.length}, deleted=${String(loadedProposal.deleted)}, totalVotesCast=${loadedProposal.totalVotesCast.toString()}).`
          );
          return loadedProposal;
        });
        const talliesPromise = runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getProposalTallies",
          args: [parsedProposalId]
        }).then((loadedTallies) => {
          const totalWeight = loadedTallies[1].reduce((sum, weight) => sum + weight, 0n);
          appendLoadingLog(`Tallies loaded (options=${loadedTallies[0].length}, totalWeight=${totalWeight.toString()}).`);
          return loadedTallies;
        });
        const votersPromise = fetchRealProposalVoters(runtime.client, contractAddress, parsedProposalId, runtime.eventLogsClient).then((loadedVoters) => {
          appendLoadingLog(`Voters reconstructed from events (${loadedVoters.length} voter records).`);
          return loadedVoters;
        });
        const [nextProposal, nextTallies, nextVoters] = await Promise.all([proposalPromise, talliesPromise, votersPromise]);
        const normalizedProposal: ProposalViewModel = {
          id: nextProposal.id,
          spaceId: nextProposal.spaceId,
          author: nextProposal.author,
          title: nextProposal.title,
          description: nextProposal.description,
          options: nextProposal.options,
          startAt: nextProposal.startAt,
          endAt: nextProposal.endAt,
          deleted: nextProposal.deleted,
          totalVotesCast: nextProposal.totalVotesCast,
          allowMultipleChoices: nextProposal.allowMultipleChoices
        };
        if (!cancelled) {
          setProposal(normalizedProposal);
          setTallies([nextTallies[0], nextTallies[1]]);
          setVoters(nextVoters);
        }

        if (runtime.effectiveAddress) {
          appendLoadingLog(`Wallet detected (${runtime.effectiveAddress}); loading voting power...`);
          const onchainPower = await runtime.client.readContract({
            address: contractAddress,
            abi: votingAbi,
            functionName: "getVotingPower",
            args: [normalizedProposal.spaceId, runtime.effectiveAddress]
          });
          appendLoadingLog(`On-chain voting power loaded: ${onchainPower.toString()}.`);
          if (!cancelled) setVotingPower(onchainPower);
        } else {
          if (!cancelled) setVotingPower(0n);
          appendLoadingLog("Wallet is not connected; voting power is set to 0.");
        }
        appendLoadingLog("Proposal page data is ready.");
      } catch (error) {
        appendLoadingLog(`Loading failed: ${normalizeError(error)}.`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [parsedProposalId, runtime.client, runtime.eventLogsClient, runtime.effectiveAddress, runtime.mockService, runtime.refreshNonce]);

  if (parsedProposalId === null) return <p>Invalid proposal id</p>;
  if (isLoading) {
    return (
      <section className="page-stack">
        <PageNavigation
          backTo="/"
          breadcrumbs={[
            { label: "Spaces", to: "/" },
            { label: `Proposal #${parsedProposalId.toString()}` }
          ]}
        />
        <Card className="page-loader">
          <div className="page-loader__spinner" aria-hidden="true" />
          <h2 className="text__title3" style={{ margin: 0 }}>
            Loading proposal #{parsedProposalId.toString()}
          </h2>
          <p className="text__paragraph muted" style={{ margin: 0 }}>
            Waiting until all required data is loaded.
          </p>
          <div className="page-loader__log-wrap">
            <p className="text__caption muted" style={{ margin: 0 }}>
              Loading log
            </p>
            <ProgressLogList entries={loadingLog} testId="proposal-loading-log" />
          </div>
        </Card>
      </section>
    );
  }
  if (!proposal || !tallies) {
    return (
      <section className="page-stack">
        <PageNavigation
          backTo="/"
          breadcrumbs={[
            { label: "Spaces", to: "/" },
            { label: `Proposal #${parsedProposalId.toString()}` }
          ]}
        />
        <Card>
          <p className="text__paragraph" style={{ margin: 0 }}>
            Loading proposal...
          </p>
        </Card>
      </section>
    );
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const proposalStatus = proposal.deleted ? "deleted" : now >= proposal.endAt ? "ended" : "active";
  const canVote = runtime.effectiveConnected && !runtime.isWrongNetwork && votingPower > 0n && proposalStatus === "active";
  const isProposalAuthor =
    runtime.effectiveConnected &&
    runtime.effectiveAddress !== null &&
    proposal.author.toLowerCase() === runtime.effectiveAddress.toLowerCase();
  const canDeleteProposal = isProposalAuthor && proposalStatus !== "deleted";
  const totalTallyWeight = tallies[1].reduce((sum, weight) => sum + weight, 0n);

  async function voteSingle(optionIndex: number) {
    if (voteActionPending !== null || runtime.txPending) return;
    setVoteActionPending("single");
    setPendingSingleOptionIndex(optionIndex);
    try {
      await runtime.executeAction({ functionName: "vote", args: [parsedProposalId, [optionIndex], [10000]] });
    } finally {
      setVoteActionPending(null);
      setPendingSingleOptionIndex(null);
    }
  }

  function toggleOption(optionIndex: number, checked: boolean) {
    setSelectedOptions((prev) => ({ ...prev, [optionIndex]: checked }));
    if (!checked) {
      setWeightsInput((prev) => {
        const copy = { ...prev };
        delete copy[optionIndex];
        return copy;
      });
    }
  }

  async function voteMulti() {
    if (voteActionPending !== null || runtime.txPending) return;
    setVoteActionPending("multi");
    const optionIndices = Object.entries(selectedOptions)
      .filter(([, checked]) => checked)
      .map(([idx]) => Number(idx))
      .sort((a, b) => a - b);
    if (optionIndices.length === 0) {
      setVoteActionPending(null);
      return;
    }
    const rawWeights = optionIndices.map((idx) => Number(weightsInput[idx] ?? ""));
    const weightsBps = normalizeWeightsToBps(rawWeights);
    if (!weightsBps) {
      setVoteActionPending(null);
      return;
    }
    try {
      const result = await runtime.executeAction({ functionName: "vote", args: [parsedProposalId, optionIndices, weightsBps] });
      if (!result) return;
      setSelectedOptions({});
      setWeightsInput({});
    } finally {
      setVoteActionPending(null);
    }
  }

  async function deleteCurrentProposal() {
    if (voteActionPending !== null || runtime.txPending) return;
    setVoteActionPending("delete");
    try {
      await runtime.executeAction({ functionName: "deleteProposal", args: [parsedProposalId] });
    } finally {
      setVoteActionPending(null);
    }
  }

  return (
    <section className="page-stack">
      <PageNavigation
        backTo={`/spaces/${proposal.spaceId.toString()}`}
        breadcrumbs={[
          { label: "Spaces", to: "/" },
          { label: `Space #${proposal.spaceId.toString()}`, to: `/spaces/${proposal.spaceId.toString()}` },
          { label: `Proposal #${proposal.id.toString()}` }
        ]}
      />
      <Card>
        <h2 className="text__title2" style={{ marginTop: 0 }}>
          Proposal #{proposal.id.toString()} - {proposal.title}
        </h2>
        <p className="text__paragraph">{proposal.description}</p>
        <p className="text__paragraph">
          Status:{" "}
          <strong className={proposalStatus === "active" ? "success" : proposalStatus === "deleted" ? "error" : "muted"}>
            {proposalStatus}
          </strong>
        </p>
        <p className="text__paragraph" data-testid="proposal-start-date" style={{ marginBottom: 0 }}>
          Start date: {unixToLocalDisplay(proposal.startAt)}
        </p>
        <p className="text__paragraph" data-testid="proposal-end-date">
          End date: {unixToLocalDisplay(proposal.endAt)}
        </p>
        <p className="text__paragraph">Your voting power: {formatEther(votingPower)} tokens</p>
        {canDeleteProposal && (
          <div className="row">
            <Button
              data-testid="delete-proposal-btn"
              variant="error"
              onClick={deleteCurrentProposal}
              disabled={runtime.txPending || runtime.isWrongNetwork || voteActionPending !== null}
            >
              {runtime.txPending || voteActionPending === "delete" ? "Deleting..." : "Delete Proposal"}
            </Button>
          </div>
        )}
      </Card>

      <Card surface="dark" className="stack-3">
        <h3 className="text__title4" style={{ margin: 0 }}>
          Current votes
        </h3>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <th>Option</th>
                <th>Weight</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tallies[0].map((option, idx) => {
                const isMulti = Boolean(proposal.allowMultipleChoices);
                const selected = selectedOptions[idx] ?? false;
                const optionWeight = tallies[1][idx] ?? 0n;
                const optionPercentBps = totalTallyWeight > 0n ? Number((optionWeight * 10000n) / totalTallyWeight) : 0;
                const optionPercent = optionPercentBps / 100;
                return (
                  <tr key={option}>
                    <td>{option}</td>
                    <td>
                      <div className="proposal-result" data-testid={`proposal-result-${idx}`}>
                        <span className="text__paragraph">{optionPercent.toFixed(2)}% ({formatEther(optionWeight)})</span>
                        <div className="proposal-result__track" role="img" aria-label={`${optionPercent.toFixed(2)} percent`}>
                          <div className="proposal-result__fill" style={{ width: `${Math.min(optionPercent, 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      {isMulti ? (
                        <div className="row">
                          <input
                            data-testid={`vote-option-check-${idx}`}
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => toggleOption(idx, e.target.checked)}
                            disabled={!canVote || runtime.txPending || voteActionPending !== null}
                          />
                          <Input
                            data-testid={`vote-option-weight-${idx}`}
                            type="number"
                            min={0}
                            step="any"
                            placeholder="weight"
                            value={weightsInput[idx] ?? ""}
                            onChange={(e) => setWeightsInput((prev) => ({ ...prev, [idx]: e.target.value }))}
                            disabled={!selected || !canVote || runtime.txPending || voteActionPending !== null}
                            style={{ width: 90 }}
                          />
                        </div>
                      ) : (
                        <Button
                          data-testid={`vote-option-${idx}`}
                          variant="primary"
                          onClick={() => voteSingle(idx)}
                          disabled={!canVote || runtime.txPending || voteActionPending !== null}
                        >
                          {pendingSingleOptionIndex === idx && (runtime.txPending || voteActionPending === "single") ? "Submitting..." : "Vote"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
        {proposal.allowMultipleChoices && (
          <div className="row">
            <Button
              data-testid="vote-multi-submit"
              variant="primary"
              onClick={voteMulti}
              disabled={!canVote || runtime.txPending || voteActionPending !== null}
            >
              {runtime.txPending || voteActionPending === "multi" ? "Submitting..." : "Submit weighted vote"}
            </Button>
            <span className="text__caption">Enter any positive numbers. Frontend normalizes them to 100% automatically.</span>
          </div>
        )}
      </Card>

      <Card surface="dark" className="stack-3">
        <h3 className="text__title4" style={{ margin: 0 }}>
          Voters
        </h3>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <th>Address</th>
                <th>Options</th>
                <th>Weights %</th>
                <th>Weight</th>
                <th>Voted at</th>
              </tr>
            </thead>
            <tbody>
              {voters.map((item) => {
                const votedOptions = item.optionIndices.map((optionIndex) => proposal.options[optionIndex] ?? `#${optionIndex}`);
                return (
                  <tr key={item.voter}>
                    <td>{item.voter}</td>
                    <td>{votedOptions.join(", ")}</td>
                    <td>{item.weightsBps.map((weight) => (weight / 100).toFixed(2)).join(", ")}</td>
                    <td>{formatEther(item.weight)}</td>
                    <td>{unixToLocalDisplay(item.updatedAt)}</td>
                  </tr>
                );
              })}
              {voters.length === 0 && (
                <tr>
                  <td colSpan={5}>No votes yet</td>
                </tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </section>
  );
}

function Pagination({
  page,
  totalPages,
  setPage
}: {
  page: number;
  totalPages: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
        Prev
      </Button>
      <span className="text__paragraph">
        Page {page}/{totalPages}
      </span>
      <Button size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
        Next
      </Button>
    </div>
  );
}

function AppRoutes() {
  const runtime = useVotingRuntime();
  return (
    <AppLayout runtime={runtime}>
      <Routes>
        <Route path="/" element={<SpacesPage runtime={runtime} />} />
        <Route path="/spaces/:spaceId" element={<SpacePage runtime={runtime} />} />
        <Route path="/spaces/:spaceId/proposals/new" element={<ProposalCreatePage runtime={runtime} />} />
        <Route path="/spaces/:spaceId/settings" element={<SpaceSettingsPage runtime={runtime} />} />
        <Route path="/proposals/:proposalId" element={<ProposalPage runtime={runtime} />} />
      </Routes>
    </AppLayout>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
