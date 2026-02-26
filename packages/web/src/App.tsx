import { useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt
} from "wagmi";
import { formatEther, parseAbiItem } from "viem";
import { votingAbi } from "./abi";

const contractAddress = (import.meta.env.VITE_VOTING_CONTRACT ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
const expectedChainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);

type ProposalCreatedLog = {
  proposalId: bigint;
};

export function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const client = usePublicClient();
  const [selectedProposal, setSelectedProposal] = useState<bigint>(1n);
  const [spaceId, setSpaceId] = useState("1");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState("Yes,No");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const { writeContractAsync, data: txHash, error: writeError } = useWriteContract();
  const { isLoading: txPending } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: proposal } = useReadContract({
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

  const [proposalIds, setProposalIds] = useState<bigint[]>([]);

  async function loadProposals() {
    if (!client) return;
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
    if (ids.length > 0) {
      setSelectedProposal(ids[ids.length - 1]);
    }
  }

  const isEnded = useMemo(() => {
    if (!proposal) return false;
    const endAtValue = proposal[7] as bigint;
    return BigInt(Math.floor(Date.now() / 1000)) >= endAtValue;
  }, [proposal]);

  async function onCreateProposal() {
    try {
      const parsedOptions = options
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (parsedOptions.length < 2) {
        setStatusMessage("Need at least two options");
        return;
      }
      await writeContractAsync({
        abi: votingAbi,
        address: contractAddress,
        functionName: "createProposal",
        args: [
          BigInt(spaceId),
          title,
          description,
          parsedOptions,
          BigInt(startAt || Math.floor(Date.now() / 1000)),
          BigInt(endAt || Math.floor(Date.now() / 1000) + 3600)
        ]
      });
      setStatusMessage("Proposal transaction sent");
      await loadProposals();
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  async function onVote(option: number) {
    if (isEnded) {
      setStatusMessage("Proposal already ended");
      return;
    }
    try {
      await writeContractAsync({
        abi: votingAbi,
        address: contractAddress,
        functionName: "vote",
        args: [selectedProposal, option]
      });
      await refetchTallies();
      setStatusMessage("Vote transaction sent");
    } catch (error) {
      setStatusMessage(String(error));
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Tetu Voting v1</h1>
      {!isConnected ? (
        <button
          onClick={() => {
            const connector = connectors[0];
            if (connector) connect({ connector });
          }}
        >
          Connect Wallet
        </button>
      ) : (
        <button onClick={() => disconnect()}>Disconnect Wallet</button>
      )}
      {isConnected && (
        <p>
          Wallet: {address} | Chain: {chainId}
        </p>
      )}
      {chainId !== expectedChainId && (
        <p style={{ color: "darkorange" }}>
          Wrong network. Expected chain id {expectedChainId}, current {chainId}.
        </p>
      )}

      <section>
        <h2>Create proposal</h2>
        <input placeholder="Space ID" value={spaceId} onChange={(e) => setSpaceId(e.target.value)} />
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          placeholder="Options comma-separated"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
        />
        <input
          placeholder="startAt unix ts (optional)"
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
        />
        <input placeholder="endAt unix ts (optional)" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        <button onClick={onCreateProposal} disabled={!isConnected || txPending}>
          Create Proposal
        </button>
      </section>

      <section>
        <h2>Proposals</h2>
        <button onClick={loadProposals}>Load from events</button>
        <ul>
          {proposalIds.map((id) => (
            <li key={id.toString()}>
              <button onClick={() => setSelectedProposal(id)}>Proposal #{id.toString()}</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Selected proposal #{selectedProposal.toString()}</h2>
        {proposal ? (
          <>
            <p>
              <strong>{proposal[3] as string}</strong> - {proposal[4] as string}
            </p>
            <p>Status: {isEnded ? "ended" : "active"}</p>
            <ul>
              {(tallyData?.[0] as string[] | undefined)?.map((option, idx) => (
                <li key={option}>
                  {option}: {formatEther(((tallyData?.[1] as bigint[] | undefined) ?? [])[idx] ?? 0n)}
                  <button onClick={() => onVote(idx)} disabled={!isConnected || txPending || isEnded}>
                    Vote
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Load proposals first</p>
        )}
      </section>

      <section>
        <h3>Activity</h3>
        <p>{statusMessage}</p>
        {txHash && <p>Tx hash: {txHash}</p>}
        {writeError && <p style={{ color: "crimson" }}>{writeError.message}</p>}
      </section>
    </main>
  );
}
