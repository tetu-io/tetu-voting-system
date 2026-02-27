import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
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
const rpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
const expectedChainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const configuredChain = getConfiguredChain(expectedChainId, rpcUrl);
const expectedChainName = configuredChain.name;
const defaultTestPrivateKey = (import.meta.env.VITE_TEST_PRIVATE_KEY as Hex | undefined) ?? "";
const useMock = import.meta.env.VITE_USE_MOCK === "true";
const enableTestWalletUi = import.meta.env.VITE_ENABLE_TEST_WALLET_LOGIN === "true";
const blockTimeSeconds = Number(import.meta.env.VITE_BLOCK_TIME_SECONDS ?? 12);
const staticPublicClient = createPublicClient({
  chain: configuredChain,
  transport: http(rpcUrl)
});
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
const erc20SymbolStringAbi = parseAbiItem("function symbol() view returns (string)");
const erc20SymbolBytes32Abi = parseAbiItem("function symbol() view returns (bytes32)");

type RuntimeContext = {
  client: PublicClient;
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

function useVotingRuntime(): RuntimeContext {
  const mockService = useMemo(() => getMockVotingService(expectedChainId) as ReturnType<typeof getMockVotingService> & MockVotingViews, []);
  const { address, isConnected, chainId: accountChainId } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const wagmiPublicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: switchNetworkPending } = useSwitchChain();

  const [txPending, setTxPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [testWalletPrivateKey, setTestWalletPrivateKey] = useState(defaultTestPrivateKey);
  const [testWalletConnected, setTestWalletConnected] = useState(Boolean(defaultTestPrivateKey));

  const testWalletClient = useMemo(() => {
    if (!isValidPrivateKey(testWalletPrivateKey)) return null;
    return createWalletClient({
      account: privateKeyToAccount(testWalletPrivateKey),
      chain: configuredChain,
      transport: http(rpcUrl)
    });
  }, [testWalletPrivateKey]);

  const usingTestWallet = !useMock && testWalletConnected && testWalletClient !== null;
  const connectedChainId = accountChainId ?? chainId;
  const isWrongNetwork = !useMock && isConnected && !usingTestWallet && connectedChainId !== expectedChainId;
  const canSwitchNetwork = isWrongNetwork && typeof switchChainAsync === "function";
  const client = isWrongNetwork ? staticPublicClient : wagmiPublicClient ?? staticPublicClient;
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
    setTxPending(true);
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
        const registryReceipt = await client.waitForTransactionReceipt({ hash: registryHash });
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
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${action.functionName}`);
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
      setStatusMessage(normalizeError(error));
      return null;
    } finally {
      setTxPending(false);
    }
  }

  return {
    client,
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
                Login
              </Button>
              {enableTestWalletUi && (
                <>
                  <Input
                    data-testid="test-wallet-key-input"
                    placeholder="0x... private key for local test wallet"
                    value={runtime.testWalletPrivateKey}
                    onChange={(e) => runtime.setTestWalletPrivateKey(e.target.value)}
                    style={{ minWidth: 320 }}
                  />
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
      {children}
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
            <div className="app-toast__body">Transaction in progress. Controls are temporarily locked until confirmation.</div>
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

  useEffect(() => {
    async function run() {
      if (useMock) {
        setSpaces(runtime.mockService.listSpaces());
        return;
      }
      setSpaces(await fetchRealSpaces(runtime.client, contractAddress));
    }
    void run();
  }, [runtime]);

  useEffect(() => {
    async function run() {
      if (useMock) {
        setSpaces(runtime.mockService.listSpaces());
        return;
      }
      setSpaces(await fetchRealSpaces(runtime.client, contractAddress));
    }
    void run();
  }, [runtime.client, runtime.mockService, runtime.refreshNonce]);

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
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("proposals");

  useEffect(() => {
    if (parsedSpaceId === null) return;
    async function run() {
      if (useMock) {
        setSpace(runtime.mockService.getSpace(parsedSpaceId));
        setProposals(runtime.mockService.listProposalsBySpace(parsedSpaceId));
        return;
      }
      const [allSpaces, bySpace] = await Promise.all([
        fetchRealSpaces(runtime.client, contractAddress),
        fetchRealProposalsBySpace(runtime.client, contractAddress, parsedSpaceId)
      ]);
      setSpace(allSpaces.find((item) => item.id === parsedSpaceId) ?? null);
      setProposals(bySpace);
    }
    void run();
  }, [parsedSpaceId, runtime.client, runtime.mockService, runtime.refreshNonce]);

  if (parsedSpaceId === null) return <p>Invalid space id</p>;
  const paged = paginateItems(proposals, page, 10);

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
            <Button onClick={() => navigate(`/spaces/${parsedSpaceId.toString()}/settings`)}>Settings</Button>
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
        {activeTab === "about" && <p className="text__paragraph">{space?.description ?? "Space not found or not loaded"}</p>}
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
  const navigate = useNavigate();
  const { spaceId } = useParams();
  const parsedSpaceId = spaceId && /^\d+$/.test(spaceId) ? BigInt(spaceId) : null;
  const [adminAccount, setAdminAccount] = useState("0x0000000000000000000000000000000000000000");
  const [allowed, setAllowed] = useState(true);
  const [delegationIdInput, setDelegationIdInput] = useState("");
  const [delegateAddress, setDelegateAddress] = useState("0x0000000000000000000000000000000000000000");

  useEffect(() => {
    if (parsedSpaceId === null) return;
    async function run() {
      if (useMock) {
        const space = runtime.mockService.getSpace(parsedSpaceId);
        if (space) {
          setDelegationIdInput(bytes32ToReadableText(space.delegationId) ?? space.delegationId);
        }
        return;
      }
      try {
        const space = await runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getSpace",
          args: [parsedSpaceId]
        });
        setDelegationIdInput(bytes32ToReadableText(space.delegationId) ?? space.delegationId);
      } catch {
        // ignore load errors on settings page
      }
    }
    void run();
  }, [parsedSpaceId, runtime.client, runtime.mockService, runtime.refreshNonce]);

  async function submit() {
    if (parsedSpaceId === null) return;
    if (!isWalletAddress(adminAccount)) return;
    const result = await runtime.executeAction({ functionName: "setAdmin", args: [parsedSpaceId, adminAccount, allowed] });
    if (!result) return;
    navigate(`/spaces/${parsedSpaceId.toString()}`);
  }

  async function saveDelegationId() {
    if (parsedSpaceId === null) return;
    const delegationId = delegateIdTextToBytes32(delegationIdInput);
    if (!delegationId) return;
    await runtime.executeAction({ functionName: "setSpaceDelegationId", args: [parsedSpaceId, delegationId] });
  }

  async function setDelegate() {
    if (parsedSpaceId === null) return;
    if (!isWalletAddress(delegateAddress)) return;
    await runtime.executeAction({ functionName: "setDelegateForSpace", args: [parsedSpaceId, delegateAddress] });
  }

  async function clearDelegate() {
    if (parsedSpaceId === null) return;
    await runtime.executeAction({ functionName: "clearDelegateForSpace", args: [parsedSpaceId] });
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
        <fieldset disabled={runtime.txPending || runtime.isWrongNetwork} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div className="stack-4">
            <Field>
              <FieldLabel>Admin address</FieldLabel>
              <Input
                data-testid="admin-account-input"
                value={adminAccount}
                onChange={(e) => setAdminAccount(e.target.value)}
                placeholder="0x..."
              />
            </Field>
            <label className="ui-checkbox-line text__paragraph">
              <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
              Allow admin role
            </label>
            <Button data-testid="set-admin-btn" variant="primary" onClick={submit} disabled={runtime.txPending || runtime.isWrongNetwork}>
              {runtime.txPending ? "Saving..." : "Save"}
            </Button>
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
            <Field>
              <FieldLabel>Delegate my voting power to</FieldLabel>
              <Input
                data-testid="space-delegate-address-input"
                value={delegateAddress}
                onChange={(e) => setDelegateAddress(e.target.value)}
                placeholder="0x..."
              />
            </Field>
            <div className="row">
              <Button
                data-testid="set-space-delegate-btn"
                variant="primary"
                onClick={setDelegate}
                disabled={!isWalletAddress(delegateAddress) || runtime.txPending || runtime.isWrongNetwork}
              >
                {runtime.txPending ? "Submitting..." : "Delegate"}
              </Button>
              <Button data-testid="clear-space-delegate-btn" onClick={clearDelegate} disabled={runtime.txPending || runtime.isWrongNetwork}>
                Clear delegate
              </Button>
            </div>
          </div>
        </fieldset>
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
  const [selectedOptions, setSelectedOptions] = useState<Record<number, boolean>>({});
  const [weightsInput, setWeightsInput] = useState<Record<number, string>>({});

  useEffect(() => {
    if (parsedProposalId === null) return;
    async function run() {
      if (useMock) {
        const mockProposal = runtime.mockService.getProposal(parsedProposalId);
        setProposal(mockProposal);
        const mockTallies = runtime.mockService.getProposalTallies(parsedProposalId);
        setTallies(mockTallies ? [mockTallies.options, mockTallies.tallies] : null);
        setVoters(runtime.mockService.listVotersForProposal(parsedProposalId));
        if (mockProposal && runtime.effectiveAddress) {
          setVotingPower(runtime.mockService.getVotingPower(mockProposal.spaceId, runtime.effectiveAddress));
        } else {
          setVotingPower(0n);
        }
        return;
      }

      const [nextProposal, nextTallies, nextVoters] = await Promise.all([
        runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getProposal",
          args: [parsedProposalId]
        }),
        runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getProposalTallies",
          args: [parsedProposalId]
        }),
        fetchRealProposalVoters(runtime.client, contractAddress, parsedProposalId)
      ]);
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
      setProposal(normalizedProposal);
      setTallies([nextTallies[0], nextTallies[1]]);
      setVoters(nextVoters);
      if (runtime.effectiveAddress) {
        const power = await runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getVotingPower",
          args: [normalizedProposal.spaceId, runtime.effectiveAddress]
        });
        setVotingPower(power);
      } else {
        setVotingPower(0n);
      }
    }
    void run();
  }, [parsedProposalId, runtime.client, runtime.effectiveAddress, runtime.mockService, runtime.refreshNonce]);

  if (parsedProposalId === null) return <p>Invalid proposal id</p>;
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
  const totalTallyWeight = tallies[1].reduce((sum, weight) => sum + weight, 0n);

  async function voteSingle(optionIndex: number) {
    await runtime.executeAction({ functionName: "vote", args: [parsedProposalId, [optionIndex], [10000]] });
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
    const optionIndices = Object.entries(selectedOptions)
      .filter(([, checked]) => checked)
      .map(([idx]) => Number(idx))
      .sort((a, b) => a - b);
    if (optionIndices.length === 0) return;
    const rawWeights = optionIndices.map((idx) => Number(weightsInput[idx] ?? ""));
    const weightsBps = normalizeWeightsToBps(rawWeights);
    if (!weightsBps) return;
    const result = await runtime.executeAction({ functionName: "vote", args: [parsedProposalId, optionIndices, weightsBps] });
    if (!result) return;
    setSelectedOptions({});
    setWeightsInput({});
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
        <p className="text__paragraph">Your voting power: {formatEther(votingPower)} tokens</p>
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
                            disabled={!canVote || runtime.txPending}
                          />
                          <Input
                            data-testid={`vote-option-weight-${idx}`}
                            type="number"
                            min={0}
                            step="any"
                            placeholder="weight"
                            value={weightsInput[idx] ?? ""}
                            onChange={(e) => setWeightsInput((prev) => ({ ...prev, [idx]: e.target.value }))}
                            disabled={!selected || !canVote || runtime.txPending}
                            style={{ width: 90 }}
                          />
                        </div>
                      ) : (
                        <Button
                          data-testid={`vote-option-${idx}`}
                          variant="primary"
                          onClick={() => voteSingle(idx)}
                          disabled={!canVote || runtime.txPending}
                        >
                          Vote
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
            <Button data-testid="vote-multi-submit" variant="primary" onClick={voteMulti} disabled={!canVote || runtime.txPending}>
              Submit weighted vote
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
