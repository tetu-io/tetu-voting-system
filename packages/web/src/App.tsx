import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeEventLog, defineChain, formatEther, http, parseAbiItem, type Hex, type PublicClient } from "viem";
import { useAccount, useChainId, useConnect, useDisconnect, usePublicClient, useWriteContract } from "wagmi";
import { votingAbi } from "./abi";
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
const defaultTestPrivateKey = (import.meta.env.VITE_TEST_PRIVATE_KEY as Hex | undefined) ?? "";
const useMock = import.meta.env.VITE_USE_MOCK === "true";
const blockTimeSeconds = Number(import.meta.env.VITE_BLOCK_TIME_SECONDS ?? 12);

const erc20BalanceOfAbi = parseAbiItem("function balanceOf(address account) view returns (uint256)");
const hardhat = defineChain({
  id: expectedChainId,
  name: "Hardhat Local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});

const staticPublicClient = createPublicClient({
  chain: hardhat,
  transport: http(rpcUrl)
});

type RuntimeContext = {
  client: PublicClient;
  mockService: ReturnType<typeof getMockVotingService> & MockVotingViews;
  effectiveAddress: WalletAddress | null | undefined;
  effectiveConnected: boolean;
  effectiveChainId: number;
  txPending: boolean;
  statusMessage: string;
  txHash: string | null;
  refreshNonce: number;
  testWalletPrivateKey: string;
  setTestWalletPrivateKey: (value: string) => void;
  testWalletValid: boolean;
  connectInjectedWallet: () => void;
  connectMockWallet: (address: WalletAddress) => void;
  disconnectAnyWallet: () => void;
  connectTestWallet: () => void;
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

function useVotingRuntime(): RuntimeContext {
  const mockService = useMemo(() => getMockVotingService(expectedChainId) as ReturnType<typeof getMockVotingService> & MockVotingViews, []);
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const wagmiPublicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

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
      chain: hardhat,
      transport: http(rpcUrl)
    });
  }, [testWalletPrivateKey]);

  const client = wagmiPublicClient ?? staticPublicClient;
  const usingTestWallet = !useMock && testWalletConnected && testWalletClient !== null;
  const mockConnectedAddress = useMock ? mockService.getConnectedAddress() : null;
  const effectiveAddress = useMock ? mockConnectedAddress : usingTestWallet ? testWalletClient.account.address : address;
  const effectiveConnected = useMock ? Boolean(mockConnectedAddress) : isConnected || usingTestWallet;
  const effectiveChainId = useMock ? mockService.getChainId() : usingTestWallet ? expectedChainId : chainId;

  async function executeAction(action: VotingAction): Promise<VotingTxResult | null> {
    if (!effectiveConnected) {
      setStatusMessage("Connect wallet first");
      return null;
    }
    setTxPending(true);
    try {
      if (useMock) {
        const receipt = await mockService.execute(action);
        setTxHash(receipt.hash);
        setStatusMessage(`Tx confirmed: ${action.functionName}`);
        setRefreshNonce((prev) => prev + 1);
        return receipt;
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
            args: action.args
          });

      setTxHash(hash);
      const receipt = await client.waitForTransactionReceipt({ hash });
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
    txPending,
    statusMessage,
    txHash,
    refreshNonce,
    testWalletPrivateKey,
    setTestWalletPrivateKey,
    testWalletValid: testWalletClient !== null,
    connectInjectedWallet: () => {
      const connector = connectors[0];
      if (connector) connect({ connector });
    },
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
    executeAction
  };
}

function Header({ runtime }: { runtime: RuntimeContext }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mockSelect, setMockSelect] = useState<WalletAddress>(runtime.mockService.getAccounts()[0]);

  useEffect(() => {
    if (!runtime.effectiveConnected) setMenuOpen(false);
  }, [runtime.effectiveConnected]);

  return (
    <Card className="app-nav">
      <header className="row-between">
        <Link to="/" className="text__title3" style={{ textDecoration: "none" }}>
          Tetu Voting v1
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
              <Button data-testid="connect-wallet" variant="primary" onClick={runtime.connectInjectedWallet}>
                Connect Wallet
              </Button>
              <Input
                data-testid="test-wallet-key-input"
                placeholder="0x... private key for local test wallet"
                value={runtime.testWalletPrivateKey}
                onChange={(e) => runtime.setTestWalletPrivateKey(e.target.value)}
                style={{ minWidth: 320 }}
              />
              {runtime.testWalletValid ? (
                <Button data-testid="connect-test-wallet" onClick={runtime.connectTestWallet}>
                  Login
                </Button>
              ) : (
                <span data-testid="invalid-test-wallet-key" className="warning text__paragraph">
                  Invalid test private key format
                </span>
              )}
            </>
          )}

          {runtime.effectiveConnected && runtime.effectiveAddress && (
            <div style={{ position: "relative" }} className="row">
              <span data-testid="wallet-status" className="text__paragraph">
                Wallet: {runtime.effectiveAddress}
              </span>
              <IconButton aria-label="menu" onClick={() => setMenuOpen((prev) => !prev)}>
                ☰
              </IconButton>
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

function AppLayout({ runtime, children }: { runtime: RuntimeContext; children: ReactNode }) {
  return (
    <main className="app-shell app-main">
      <Header runtime={runtime} />
      {useMock && (
        <StatusMessage data-testid="mock-mode-banner" tone="warning">
          Mock mode enabled (`VITE_USE_MOCK=true`): wallet and contracts are simulated in-memory.
        </StatusMessage>
      )}
      {runtime.effectiveConnected && (
        <Card surface="dark">
          Active wallet: {runtime.effectiveAddress} | Chain: {runtime.effectiveChainId}
        </Card>
      )}
      {runtime.effectiveChainId !== expectedChainId && (
        <StatusMessage data-testid="chain-warning" tone="warning">
          <Tooltip content="Switch wallet network to the configured chain id to submit transactions.">
            <span>Wrong network. Expected chain id {expectedChainId}, current {runtime.effectiveChainId}.</span>
          </Tooltip>
        </StatusMessage>
      )}
      <StatusMessage data-testid="status-message" tone={detectStatusTone(runtime.statusMessage)}>
        {runtime.statusMessage || "Ready"}
      </StatusMessage>
      {runtime.txHash && (
        <Card surface="dark">
          <p data-testid="tx-hash" className="text__paragraph" style={{ margin: 0 }}>
            Tx hash: {runtime.txHash}
          </p>
        </Card>
      )}
      {children}
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
          <Button data-testid="open-create-space-modal" variant="primary" onClick={() => setOpenCreate(true)}>
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
                  <td>{shortAddress(space.token)}</td>
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

      <Modal open={openCreate} wide onOverlayClick={() => setOpenCreate(false)}>
        <div className="stack-3">
          <h3 className="text__title3" style={{ margin: 0 }}>
            Create Space
          </h3>
          <Field>
            <FieldLabel>Token address</FieldLabel>
            <Input data-testid="space-token-input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token address" />
          </Field>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input data-testid="space-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              data-testid="space-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
            />
          </Field>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setOpenCreate(false)}>Cancel</Button>
            <Button data-testid="create-space-btn" variant="primary" onClick={createSpace} disabled={runtime.txPending}>
              Create
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
            <p className="text__paragraph">{space?.description ?? "Space not found or not loaded"}</p>
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
                  disabled={options.length <= 2}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button onClick={() => setOptions((prev) => [...prev, `Option ${prev.length + 1}`])}>Add option</Button>
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

          <Button data-testid="create-proposal-btn" variant="primary" onClick={submit} disabled={runtime.txPending}>
            Create Proposal
          </Button>
        </div>
      </Card>
    </section>
  );
}

function SpaceSettingsPage({ runtime }: { runtime: RuntimeContext }) {
  const { spaceId } = useParams();
  const parsedSpaceId = spaceId && /^\d+$/.test(spaceId) ? BigInt(spaceId) : null;
  const [adminAccount, setAdminAccount] = useState("0x0000000000000000000000000000000000000000");
  const [allowed, setAllowed] = useState(true);

  if (parsedSpaceId === null) return <p>Invalid space id</p>;

  async function submit() {
    if (!isWalletAddress(adminAccount)) return;
    await runtime.executeAction({ functionName: "setAdmin", args: [parsedSpaceId, adminAccount, allowed] });
  }

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
          <Button data-testid="set-admin-btn" variant="primary" onClick={submit} disabled={runtime.txPending}>
            Save
          </Button>
        </div>
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
        const space = await runtime.client.readContract({
          address: contractAddress,
          abi: votingAbi,
          functionName: "getSpace",
          args: [normalizedProposal.spaceId]
        });
        const balance = await runtime.client.readContract({
          address: space.token,
          abi: [erc20BalanceOfAbi],
          functionName: "balanceOf",
          args: [runtime.effectiveAddress]
        });
        setVotingPower(balance);
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
  const canVote = runtime.effectiveConnected && votingPower > 0n && proposalStatus === "active";

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
    const weightsBps = optionIndices.map((idx) => {
      const value = Number(weightsInput[idx] ?? "");
      if (!Number.isFinite(value) || value <= 0) return NaN;
      return Math.round(value * 100);
    });
    if (weightsBps.some((item) => !Number.isFinite(item) || item <= 0)) return;
    const total = weightsBps.reduce((sum, item) => sum + item, 0);
    if (total !== 10000) return;
    await runtime.executeAction({ functionName: "vote", args: [parsedProposalId, optionIndices, weightsBps] });
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
        <p className="text__paragraph">Voting power: {formatEther(votingPower)} tokens</p>
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
                return (
                  <tr key={option}>
                    <td>{option}</td>
                    <td>{formatEther(tallies[1][idx] ?? 0n)}</td>
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
                            step={0.01}
                            placeholder="%"
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
            <span className="text__caption">Sum must be exactly 100.00%</span>
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
                <th>Option indices</th>
                <th>Weights %</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {voters.map((item) => (
                <tr key={item.voter}>
                  <td>{item.voter}</td>
                  <td>{item.optionIndices.join(", ")}</td>
                  <td>{item.weightsBps.map((weight) => (weight / 100).toFixed(2)).join(", ")}</td>
                  <td>{formatEther(item.weight)}</td>
                </tr>
              ))}
              {voters.length === 0 && (
                <tr>
                  <td colSpan={4}>No votes yet</td>
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
