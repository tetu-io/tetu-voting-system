import { useMemo, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import {
  decodeEventLog,
  defineChain,
  formatEther,
  http,
  parseAbiItem,
  type Hex
} from "viem";
import { createPublicClient, createWalletClient } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWriteContract
} from "wagmi";
import { votingAbi } from "./abi";

const contractAddress = (import.meta.env.VITE_VOTING_CONTRACT ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
const rpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
const expectedChainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const testPrivateKey = (import.meta.env.VITE_TEST_PRIVATE_KEY as Hex | undefined) ?? undefined;

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

const staticTestWalletClient = testPrivateKey
  ? createWalletClient({
      account: privateKeyToAccount(testPrivateKey),
      chain: hardhat,
      transport: http(rpcUrl)
    })
  : null;

type ProposalCreatedLog = {
  proposalId: bigint;
};

export function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const wagmiPublicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [testWalletConnected, setTestWalletConnected] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<bigint>(1n);
  const [proposalIds, setProposalIds] = useState<bigint[]>([]);
  const [spaceId, setSpaceId] = useState("1");
  const [statusMessage, setStatusMessage] = useState("");

  const [spaceToken, setSpaceToken] = useState("0x0000000000000000000000000000000000000000");
  const [spaceName, setSpaceName] = useState("New Space");
  const [spaceDescription, setSpaceDescription] = useState("Created from frontend");
  const [adminAccount, setAdminAccount] = useState("0x0000000000000000000000000000000000000000");
  const [proposerAccount, setProposerAccount] = useState("0x0000000000000000000000000000000000000000");
  const [roleAllowed, setRoleAllowed] = useState(true);
  const [title, setTitle] = useState("Frontend proposal");
  const [description, setDescription] = useState("Created in e2e flow");
  const [options, setOptions] = useState("Yes,No,Abstain");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  const client = wagmiPublicClient ?? staticPublicClient;
  const usingTestWallet = testWalletConnected && staticTestWalletClient !== null;
  const effectiveAddress = usingTestWallet ? staticTestWalletClient!.account.address : address;
  const effectiveConnected = isConnected || usingTestWallet;
  const effectiveChainId = usingTestWallet ? expectedChainId : chainId;

  const { data: spaceData, refetch: refetchSpace } = useReadContract({
    abi: votingAbi,
    address: contractAddress,
    functionName: "getSpace",
    args: [BigInt(spaceId)],
    query: { enabled: spaceId.length > 0 }
  });
  const { data: proposal, refetch: refetchProposal } = useReadContract({
    abi: votingAbi,
    address: contractAddress,
    functionName: "getProposal",
    args: [selectedProposal]
  });
  const { data: tallyData, refetch: refetchTallies } = useReadContract({
    abi: votingAbi,
    address: contractAddress,
    functionName: "getProposalTallies",
    args: [selectedProposal]
  });
  const { data: isAdmin } = useReadContract({
    abi: votingAbi,
    address: contractAddress,
    functionName: "isAdmin",
    args: [BigInt(spaceId), adminAccount as `0x${string}`],
    query: { enabled: adminAccount.startsWith("0x") && adminAccount.length === 42 }
  });
  const { data: isProposer } = useReadContract({
    abi: votingAbi,
    address: contractAddress,
    functionName: "isProposer",
    args: [BigInt(spaceId), proposerAccount as `0x${string}`],
    query: { enabled: proposerAccount.startsWith("0x") && proposerAccount.length === 42 }
  });

  const isEnded = useMemo(() => {
    if (!proposal) return false;
    const endAtValue = proposal[7] as bigint;
    return BigInt(Math.floor(Date.now() / 1000)) >= endAtValue;
  }, [proposal]);

  function normalizeError(error: unknown): string {
    const raw = String(error);
    if (raw.includes("User rejected")) return "User rejected transaction";
    if (raw.includes("ProposalEnded")) return "Proposal ended";
    if (raw.includes("ProposalNotStarted")) return "Proposal not started";
    if (raw.includes("ProposalIsDeleted")) return "Proposal deleted";
    if (raw.includes("Unauthorized")) return "Unauthorized action";
    if (raw.includes("InvalidOption")) return "Invalid option";
    return raw;
  }

  async function submitWrite(functionName: string, args: unknown[]) {
    if (!effectiveConnected) {
      setStatusMessage("Connect wallet first");
      return;
    }
    setTxPending(true);
    try {
      const hash = usingTestWallet
        ? await staticTestWalletClient!.writeContract({
            address: contractAddress,
            abi: votingAbi,
            functionName,
            args
          })
        : await writeContractAsync({
            address: contractAddress,
            abi: votingAbi,
            functionName,
            args
          });
      setTxHash(hash);
      const receipt = await client.waitForTransactionReceipt({ hash });
      setStatusMessage(`Tx confirmed: ${functionName}`);
      return receipt;
    } catch (error) {
      setStatusMessage(normalizeError(error));
      return null;
    } finally {
      setTxPending(false);
    }
  }

  async function loadProposals() {
    const logs = await client.getLogs({
      address: contractAddress,
      event: parseAbiItem(
        "event ProposalCreated(uint256 indexed proposalId, uint256 indexed spaceId, address indexed author, uint64 startAt, uint64 endAt)"
      ),
      fromBlock: 0n,
      toBlock: "latest"
    });
    const ids = logs
      .map((log) => (log.args as unknown as ProposalCreatedLog).proposalId)
      .filter((id): id is bigint => typeof id === "bigint");
    setProposalIds(ids);
    if (ids.length > 0) setSelectedProposal(ids[ids.length - 1]);
  }

  async function onCreateSpace() {
    const receipt = await submitWrite("createSpace", [
      spaceToken as `0x${string}`,
      spaceName,
      spaceDescription
    ]);
    if (!receipt) return;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: votingAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "SpaceCreated") {
          const createdId = decoded.args.spaceId as bigint;
          setSpaceId(createdId.toString());
          setStatusMessage(`Space created: ${createdId.toString()}`);
          await refetchSpace();
        }
      } catch {
        // ignore unrelated logs
      }
    }
  }

  async function onSetAdmin() {
    await submitWrite("setAdmin", [BigInt(spaceId), adminAccount as `0x${string}`, roleAllowed]);
  }

  async function onSetProposer() {
    await submitWrite("setProposer", [BigInt(spaceId), proposerAccount as `0x${string}`, roleAllowed]);
  }

  async function onCreateProposal() {
    const parsedOptions = options
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (parsedOptions.length < 2) {
      setStatusMessage("Need at least two options");
      return;
    }
    const receipt = await submitWrite("createProposal", [
      BigInt(spaceId),
      title,
      description,
      parsedOptions,
      BigInt(startAt || Math.floor(Date.now() / 1000)),
      BigInt(endAt || Math.floor(Date.now() / 1000) + 3600)
    ]);
    if (!receipt) return;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: votingAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "ProposalCreated") {
          const createdId = decoded.args.proposalId as bigint;
          setSelectedProposal(createdId);
          setProposalIds((prev) => [...new Set([...prev, createdId])]);
          setStatusMessage(`Proposal created: ${createdId.toString()}`);
        }
      } catch {
        // ignore unrelated logs
      }
    }
    await refetchProposal();
    await refetchTallies();
  }

  async function onDeleteProposal() {
    await submitWrite("deleteProposal", [selectedProposal]);
    await refetchProposal();
  }

  async function onVote(option: number) {
    if (isEnded) {
      setStatusMessage("Proposal already ended");
      return;
    }
    await submitWrite("vote", [selectedProposal, option]);
    await refetchTallies();
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Tetu Voting v1</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {!isConnected && (
          <button
            data-testid="connect-wallet"
            onClick={() => {
              const connector = connectors[0];
              if (connector) connect({ connector });
            }}
          >
            Connect Wallet
          </button>
        )}
        {staticTestWalletClient && !usingTestWallet && (
          <button data-testid="connect-test-wallet" onClick={() => setTestWalletConnected(true)}>
            Connect Test Wallet
          </button>
        )}
        {(isConnected || usingTestWallet) && (
          <button
            data-testid="disconnect-wallet"
            onClick={() => {
              setTestWalletConnected(false);
              if (isConnected) disconnect();
            }}
          >
            Disconnect Wallet
          </button>
        )}
      </div>

      {effectiveConnected && (
        <p data-testid="wallet-status">
          Wallet: {effectiveAddress} | Chain: {effectiveChainId}
        </p>
      )}
      {effectiveChainId !== expectedChainId && (
        <p data-testid="chain-warning" style={{ color: "darkorange" }}>
          Wrong network. Expected chain id {expectedChainId}, current {effectiveChainId}.
        </p>
      )}

      <section>
        <h2>Create space</h2>
        <input
          data-testid="space-token-input"
          placeholder="Token address"
          value={spaceToken}
          onChange={(e) => setSpaceToken(e.target.value)}
        />
        <input
          data-testid="space-name-input"
          placeholder="Space name"
          value={spaceName}
          onChange={(e) => setSpaceName(e.target.value)}
        />
        <input
          data-testid="space-description-input"
          placeholder="Space description"
          value={spaceDescription}
          onChange={(e) => setSpaceDescription(e.target.value)}
        />
        <button data-testid="create-space-btn" onClick={onCreateSpace} disabled={!effectiveConnected || txPending}>
          Create Space
        </button>
      </section>

      <section>
        <h2>Manage roles</h2>
        <input
          data-testid="space-id-input"
          placeholder="Space ID"
          value={spaceId}
          onChange={(e) => setSpaceId(e.target.value)}
        />
        <input
          data-testid="admin-account-input"
          placeholder="Admin account"
          value={adminAccount}
          onChange={(e) => setAdminAccount(e.target.value)}
        />
        <input
          data-testid="proposer-account-input"
          placeholder="Proposer account"
          value={proposerAccount}
          onChange={(e) => setProposerAccount(e.target.value)}
        />
        <label>
          <input
            data-testid="role-allowed-checkbox"
            type="checkbox"
            checked={roleAllowed}
            onChange={(e) => setRoleAllowed(e.target.checked)}
          />
          allowed
        </label>
        <button data-testid="set-admin-btn" onClick={onSetAdmin} disabled={!effectiveConnected || txPending}>
          Set Admin
        </button>
        <button data-testid="set-proposer-btn" onClick={onSetProposer} disabled={!effectiveConnected || txPending}>
          Set Proposer
        </button>
        <p data-testid="role-state">
          isAdmin={String(isAdmin ?? false)} isProposer={String(isProposer ?? false)}
        </p>
      </section>

      <section>
        <h2>Create proposal</h2>
        <input
          data-testid="proposal-title-input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          data-testid="proposal-description-input"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          data-testid="proposal-options-input"
          placeholder="Options comma-separated"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
        />
        <input
          data-testid="proposal-start-input"
          placeholder="startAt unix ts (optional)"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
        />
        <input
          data-testid="proposal-end-input"
          placeholder="endAt unix ts (optional)"
          value={endAt}
          onChange={(e) => setEndAt(e.target.value)}
        />
        <button
          data-testid="create-proposal-btn"
          onClick={onCreateProposal}
          disabled={!effectiveConnected || txPending}
        >
          Create Proposal
        </button>
      </section>

      <section>
        <h2>Proposals</h2>
        <button data-testid="load-proposals-btn" onClick={loadProposals}>
          Load from events
        </button>
        <ul data-testid="proposal-list">
          {proposalIds.map((id) => (
            <li key={id.toString()}>
              <button data-testid={`select-proposal-${id.toString()}`} onClick={() => setSelectedProposal(id)}>
                Proposal #{id.toString()}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 data-testid="selected-proposal-title">Selected proposal #{selectedProposal.toString()}</h2>
        {proposal ? (
          <>
            <p data-testid="proposal-meta">
              <strong>{proposal[3] as string}</strong> - {proposal[4] as string}
            </p>
            <p data-testid="proposal-status">Status: {isEnded ? "ended" : "active"}</p>
            <ul data-testid="proposal-tallies">
              {(tallyData?.[0] as string[] | undefined)?.map((option, idx) => (
                <li key={option}>
                  {option}: {formatEther(((tallyData?.[1] as bigint[] | undefined) ?? [])[idx] ?? 0n)}
                  <button
                    data-testid={`vote-option-${idx}`}
                    onClick={() => onVote(idx)}
                    disabled={!effectiveConnected || txPending || isEnded}
                  >
                    Vote
                  </button>
                </li>
              ))}
            </ul>
            <button data-testid="delete-proposal-btn" onClick={onDeleteProposal} disabled={!effectiveConnected}>
              Delete Proposal
            </button>
          </>
        ) : (
          <p>Load proposals first</p>
        )}
      </section>

      <section>
        <h3>Current space</h3>
        <p data-testid="space-meta">
          {spaceData
            ? `${(spaceData[3] as string)} / ${(spaceData[4] as string)}`
            : "Space is not loaded or does not exist"}
        </p>
      </section>

      <section>
        <h3>Activity</h3>
        <p data-testid="status-message">{statusMessage}</p>
        {txHash && <p data-testid="tx-hash">Tx hash: {txHash}</p>}
      </section>
    </main>
  );
}
