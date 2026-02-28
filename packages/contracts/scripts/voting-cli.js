#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { config: dotenvConfig } = require("dotenv");

dotenvConfig({ path: path.resolve(__dirname, "../.env") });
dotenvConfig({ path: path.resolve(__dirname, "../../../.env") });

const votingAbi = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../shared/src/voting-abi.json"), "utf8")
);

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }
  return { positional, options };
}

function usage() {
  console.log(`Usage:
  node packages/contracts/scripts/voting-cli.js proposal:create --space-id 1 --title "T" --description "D" --options "Yes,No" --start-at 1 --end-at 2 [--allow-multi] [--contract 0x..] [--json]
  node packages/contracts/scripts/voting-cli.js vote:cast --proposal-id 1 --option 0 [--contract 0x..] [--json]
  node packages/contracts/scripts/voting-cli.js results:read --proposal-id 1 [--contract 0x..] [--json]
  node packages/contracts/scripts/voting-cli.js delegation:sync --space-id 1 --days 30 [--fetch-batch-size 1000] [--sync-batch-size 100] [--skip-checkpoint] [--verbose] [--contract 0x..] [--json]

Environment (required):
  SCRIPT_RPC_URL or CLI_RPC_URL
  SCRIPT_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY
  CLI_CONTRACT (or pass --contract)`);
}

function printOutput(payload, asJson) {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  Object.entries(payload).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });
}

function requiredOption(options, key) {
  const value = options[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

function getRpcUrl() {
  const value = process.env.SCRIPT_RPC_URL || process.env.CLI_RPC_URL;
  if (!value) {
    throw new Error("Missing env SCRIPT_RPC_URL (or CLI_RPC_URL)");
  }
  return value;
}

function getPrivateKey() {
  const value = process.env.SCRIPT_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!value) {
    throw new Error("Missing env SCRIPT_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY)");
  }
  return value;
}

function getContractAddress(options) {
  return options.contract || process.env.CLI_CONTRACT;
}

function parseDateBound(value, endOfDay) {
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? "23:59:59" : "00:00:00"}`
    : trimmed;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return BigInt(Math.floor(parsed / 1000));
}

async function findBlockAtOrAfter(provider, targetTs) {
  const latestBlockNumber = await provider.getBlockNumber();
  const latestBlock = await provider.getBlock(latestBlockNumber);
  if (!latestBlock) return latestBlockNumber;
  if (BigInt(latestBlock.timestamp) <= targetTs) return latestBlockNumber;

  let low = 0;
  let high = latestBlockNumber;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await provider.getBlock(mid);
    const blockTs = BigInt(block?.timestamp ?? 0);
    if (blockTs < targetTs) low = mid + 1;
    else high = mid;
  }
  return low;
}

async function findBlockAtOrBefore(provider, targetTs) {
  const latestBlockNumber = await provider.getBlockNumber();
  const latestBlock = await provider.getBlock(latestBlockNumber);
  if (!latestBlock) return 0;
  if (BigInt(latestBlock.timestamp) <= targetTs) return latestBlockNumber;
  const firstAtOrAfter = await findBlockAtOrAfter(provider, targetTs);
  const candidate = Math.max(0, firstAtOrAfter - 1);
  const candidateBlock = await provider.getBlock(candidate);
  if (BigInt(candidateBlock?.timestamp ?? 0) <= targetTs) return candidate;
  return 0;
}

function topicAddressToChecksum(topicValue) {
  return ethers.getAddress(`0x${String(topicValue).slice(-40)}`);
}

function splitMonthlyRanges(fromTs, toTs) {
  const ranges = [];
  let cursor = Number(fromTs);
  const end = Number(toTs);
  while (cursor <= end) {
    const cursorDate = new Date(cursor * 1000);
    const nextMonthStart = Math.floor(
      Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() + 1, 1, 0, 0, 0) / 1000
    );
    const monthEnd = nextMonthStart - 1;
    const currentEnd = Math.min(end, monthEnd);
    ranges.push({ fromTs: BigInt(cursor), toTs: BigInt(currentEnd) });
    cursor = currentEnd + 1;
  }
  return ranges;
}

function formatDetailedError(err) {
  const lines = [];
  const pushLine = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      lines.push(`${key}: ${String(value)}`);
    }
  };

  if (typeof err === "string") {
    pushLine("message", err);
    return lines.join(" | ");
  }
  if (!err || typeof err !== "object") {
    pushLine("message", String(err));
    return lines.join(" | ");
  }

  pushLine("name", err.name);
  pushLine("code", err.code);
  pushLine("shortMessage", err.shortMessage);
  pushLine("reason", err.reason);
  pushLine("message", err.message);

  if (err.transaction) {
    pushLine("tx.to", err.transaction.to);
    pushLine("tx.from", err.transaction.from);
    pushLine("tx.data", err.transaction.data);
  }

  if (err.invocation) {
    pushLine("invocation.method", err.invocation.method);
    pushLine("invocation.signature", err.invocation.signature);
    if (Array.isArray(err.invocation.args)) {
      pushLine(
        "invocation.args",
        JSON.stringify(err.invocation.args, (_, v) => (typeof v === "bigint" ? v.toString() : v))
      );
    }
  }

  if (err.error) {
    pushLine("inner.code", err.error.code);
    pushLine("inner.message", err.error.message);
  }
  if (err.info) {
    pushLine("info.error.message", err.info?.error?.message);
    pushLine("info.payload.method", err.info?.payload?.method);
  }
  if (err.data !== undefined) {
    pushLine("data", err.data);
  }

  return lines.join(" | ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(actionName, attempts, delayMs, action, onRetry) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      if (onRetry) onRetry(attempt, err);
      await sleep(delayMs);
    }
  }
  const details = formatDetailedError(lastError);
  throw new Error(`${actionName} failed after ${attempts} attempts. ${details}`);
}

function formatDurationMs(startMs) {
  const ms = Date.now() - startMs;
  const seconds = (ms / 1000).toFixed(2);
  return `${seconds}s`;
}

async function runAndWait(actionName, callback, provider, verboseLog, stopOnError = true, pollMs = 10000) {
  const start = Date.now();
  verboseLog(`${actionName}: RUN AND WAIT started`);
  const tx = await callback();
  verboseLog(`${actionName}: tx sent ${tx.hash}`);

  const firstReceipt = await tx.wait(1);
  if (firstReceipt) {
    verboseLog(
      `${actionName}: wait(1) complete hash=${tx.hash} status=${firstReceipt.status} gasUsed=${firstReceipt.gasUsed?.toString?.() ?? "n/a"}`
    );
  } else {
    verboseLog(`${actionName}: wait(1) returned empty receipt`);
  }

  let receipt = firstReceipt ?? null;
  while (!receipt) {
    receipt = await provider.getTransactionReceipt(tx.hash);
    if (!receipt) {
      verboseLog(`${actionName}: not yet complete ${tx.hash}, retry in ${pollMs}ms`);
      await sleep(pollMs);
    }
  }

  verboseLog(
    `${actionName}: transaction result hash=${tx.hash} status=${receipt.status} gasUsed=${receipt.gasUsed?.toString?.() ?? "n/a"}`
  );
  if (receipt.status !== 1 && stopOnError) {
    throw new Error(`${actionName}: Wrong status! tx=${tx.hash} status=${String(receipt.status)}`);
  }
  verboseLog(`${actionName}: runAndWait completed in ${formatDurationMs(start)}`);
  return { tx, receipt };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command || options.help || options.h) {
    usage();
    return;
  }

  const rpcUrl = getRpcUrl();
  const privateKey = getPrivateKey();
  const contractAddress = getContractAddress(options);
  if (!contractAddress) {
    throw new Error("Missing contract address: pass --contract or set CLI_CONTRACT");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, votingAbi, signer);
  const asJson = Boolean(options.json);

  if (command === "proposal:create") {
    const parsedOptions = String(requiredOption(options, "options"))
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const tx = await contract.createProposal(
      BigInt(requiredOption(options, "space-id")),
      requiredOption(options, "title"),
      requiredOption(options, "description"),
      parsedOptions,
      BigInt(requiredOption(options, "start-at")),
      BigInt(requiredOption(options, "end-at")),
      Boolean(options["allow-multi"])
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log && log.name === "ProposalCreated");
    const proposalId = event?.args?.proposalId?.toString() ?? "unknown";
    printOutput({ txHash: tx.hash, proposalId, message: `Proposal ${proposalId} created` }, asJson);
    return;
  }

  if (command === "vote:cast") {
    const proposalId = BigInt(requiredOption(options, "proposal-id"));
    const option = Number(requiredOption(options, "option"));
    const before = await contract.getVoteReceipt(proposalId, signer.address);
    const wasFirstVote = !before.hasVoted;
    const tx = await contract.vote(proposalId, [option], [10000]);
    await tx.wait();
    const after = await contract.getVoteReceipt(proposalId, signer.address);
    printOutput(
      {
        txHash: tx.hash,
        mode: wasFirstVote ? "first-vote" : "re-vote",
        effectiveWeight: after.weight.toString()
      },
      asJson
    );
    return;
  }

  if (command === "results:read") {
    const proposalId = BigInt(requiredOption(options, "proposal-id"));
    const readContract = new ethers.Contract(contractAddress, votingAbi, provider);
    const proposal = await readContract.getProposal(proposalId);
    const [voteOptions, tallies] = await readContract.getProposalTallies(proposalId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const status = proposal.deleted ? "deleted" : now >= proposal.endAt ? "ended" : "active";
    printOutput(
      {
        proposalId: proposal.id.toString(),
        title: proposal.title,
        description: proposal.description,
        status,
        options: JSON.stringify(
          voteOptions.map((option, i) => ({ option, tally: tallies[i].toString() })),
          null,
          asJson ? 2 : 0
        )
      },
      asJson
    );
    return;
  }

  if (command === "delegation:sync") {
    const spaceId = BigInt(requiredOption(options, "space-id"));
    const windowDays = Number.parseInt(String(requiredOption(options, "days")), 10);
    if (!Number.isFinite(windowDays) || windowDays <= 0) throw new Error("Invalid --days");
    const verbose = Boolean(options.verbose);
    const verboseLog = (...args) => {
      if (verbose) {
        // Keep stdout clean for --json consumers.
        console.error("[delegation:sync]", ...args);
      }
    };
    const operationLog = (...args) => {
      console.error("[delegation:sync]", ...args);
    };

    const fetchBatchSize = Number.parseInt(String(options["fetch-batch-size"] ?? "1000"), 10);
    const syncBatchSize = Number.parseInt(String(options["sync-batch-size"] ?? "100"), 10);
    if (!Number.isFinite(fetchBatchSize) || fetchBatchSize <= 0) throw new Error("Invalid --fetch-batch-size");
    if (!Number.isFinite(syncBatchSize) || syncBatchSize <= 0) throw new Error("Invalid --sync-batch-size");
    const fetchRetryAttempts = 100;
    const fetchRetryDelayMs = 10000;

    const space = await contract.getSpace(spaceId);
    const registryAddress = await contract.delegateRegistry();
    if (registryAddress === ethers.ZeroAddress) throw new Error("DelegateRegistryNotSet");
    if (space.delegationId === ethers.ZeroHash) throw new Error("DelegationIdNotSet");

    const fallbackFromTs = parseDateBound("2021-11-01", false);
    const [cpFromTs, cpToTs] = await contract.getSpaceDelegationSyncPeriod(spaceId);
    const checkpointExists = cpFromTs !== 0n || cpToTs !== 0n;
    const baseTs = checkpointExists ? (cpToTs !== 0n ? cpToTs : cpFromTs) : fallbackFromTs;
    const fromTs = checkpointExists ? baseTs + 1n : baseTs;
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const requestedToTs = fromTs + BigInt(windowDays) * 86400n - 1n;
    const toTs = requestedToTs > nowTs ? nowTs : requestedToTs;
    if (fromTs > toTs) {
      printOutput(
        {
          message: "No-op: computed range starts after current time",
          spaceId: spaceId.toString(),
          days: windowDays,
          checkpointFromTs: cpFromTs.toString(),
          checkpointToTs: cpToTs.toString(),
          fromTs: fromTs.toString(),
          toTs: toTs.toString()
        },
        asJson
      );
      return;
    }

    const setDelegateTopic = ethers.id("SetDelegate(address,bytes32,address)");
    const clearDelegateTopicLegacy = ethers.id("ClearDelegate(address,bytes32)");
    const clearDelegateTopicIndexed = ethers.id("ClearDelegate(address,bytes32,address)");
    const delegationIdTopic = ethers.zeroPadValue(space.delegationId, 32);

    const registry = new ethers.Contract(
      registryAddress,
      ["function delegation(address delegator, bytes32 id) view returns (address)"],
      provider
    );

    const monthlyRanges = splitMonthlyRanges(fromTs, toTs);
    verboseLog(
      `start spaceId=${spaceId.toString()} days=${windowDays} fromTs=${fromTs.toString()} toTs=${toTs.toString()} months=${monthlyRanges.length} source=${checkpointExists ? "checkpoint" : "default-2021-11-01"} fetchBatchSize=${fetchBatchSize} syncBatchSize=${syncBatchSize}`
    );
    let totalFoundDelegations = 0;
    let totalOutdatedDelegations = 0;
    let totalSyncedDelegations = 0;
    let anySyncInterrupted = false;
    const monthlyStats = [];
    const isSpaceOwner = String(space.owner).toLowerCase() === signer.address.toLowerCase();
    let checkpointUpdates = 0;
    let checkpointSkips = 0;
    let canReadIndexedDelegate = true;
    let currentCheckpoint = { fromTs: cpFromTs, toTs: cpToTs };
    if (!options["skip-checkpoint"] && isSpaceOwner) {
      verboseLog(
        `current checkpoint fromTs=${currentCheckpoint.fromTs.toString()} toTs=${currentCheckpoint.toTs.toString()}`
      );
    }

    for (const monthRange of monthlyRanges) {
      const monthFromIso = new Date(Number(monthRange.fromTs) * 1000).toISOString();
      const monthToIso = new Date(Number(monthRange.toTs) * 1000).toISOString();
      verboseLog(`month begin ${monthFromIso}..${monthToIso}`);
      const monthFromBlock = await findBlockAtOrAfter(provider, monthRange.fromTs);
      const monthToBlock = await findBlockAtOrBefore(provider, monthRange.toTs);
      verboseLog(`month blocks from=${monthFromBlock} to=${monthToBlock}`);

      if (monthToBlock < monthFromBlock) {
        let checkpointUpdated = false;
        const canWriteCheckpointForMonth =
          monthRange.fromTs >= currentCheckpoint.fromTs && monthRange.toTs >= currentCheckpoint.toTs;
        if (!options["skip-checkpoint"] && isSpaceOwner && canWriteCheckpointForMonth) {
          try {
            const { receipt, tx } = await runAndWait(
              `checkpoint update (${monthFromIso}..${monthToIso})`,
              () => contract.setSpaceDelegationSyncPeriod(spaceId, monthRange.fromTs, monthRange.toTs),
              provider,
              operationLog
            );
            checkpointUpdated = receipt?.status === 1;
            if (checkpointUpdated) {
              checkpointUpdates += 1;
              currentCheckpoint = { fromTs: monthRange.fromTs, toTs: monthRange.toTs };
              verboseLog(`checkpoint updated for month tx=${tx.hash}`);
            }
          } catch (err) {
            const details = formatDetailedError(err);
            throw new Error(
              `Checkpoint write failed for month ${monthFromIso}..${monthToIso} (spaceId=${spaceId.toString()}). ${details}`
            );
          }
        } else if (!options["skip-checkpoint"] && isSpaceOwner && !canWriteCheckpointForMonth) {
          checkpointSkips += 1;
          verboseLog(
            `skip checkpoint for month ${monthFromIso}..${monthToIso}: non-monotonic vs current checkpoint fromTs=${currentCheckpoint.fromTs.toString()} toTs=${currentCheckpoint.toTs.toString()}`
          );
        }
        monthlyStats.push({
          fromTs: monthRange.fromTs.toString(),
          toTs: monthRange.toTs.toString(),
          fromBlock: monthFromBlock,
          toBlock: monthToBlock,
          foundDelegations: 0,
          outdatedDelegations: 0,
          syncedDelegations: 0,
          checkpointUpdated
        });
        continue;
      }

      const uniqueDelegators = new Set();
      let rangesProcessed = 0;
      const totalRanges = Math.max(1, Math.ceil((monthToBlock - monthFromBlock + 1) / fetchBatchSize));
      for (let currentFrom = monthFromBlock; currentFrom <= monthToBlock; currentFrom += fetchBatchSize) {
        const currentTo = Math.min(monthToBlock, currentFrom + fetchBatchSize - 1);
        rangesProcessed += 1;
        verboseLog(`fetch logs range ${rangesProcessed}/${totalRanges}: blocks ${currentFrom}-${currentTo}`);
        const retryLog = (attempt, err, label) =>
          verboseLog(
            `${label} retry ${attempt}/${fetchRetryAttempts - 1} after error: ${formatDetailedError(err)}`
          );
        const [setLogs, clearLegacyLogs, clearIndexedLogs] = await Promise.all([
          withRetry(
            `getLogs SetDelegate [${currentFrom}-${currentTo}]`,
            fetchRetryAttempts,
            fetchRetryDelayMs,
            () =>
              provider.getLogs({
                address: registryAddress,
                topics: [setDelegateTopic, null, delegationIdTopic],
                fromBlock: currentFrom,
                toBlock: currentTo
              }),
            (attempt, err) => retryLog(attempt, err, "SetDelegate")
          ),
          withRetry(
            `getLogs ClearDelegateLegacy [${currentFrom}-${currentTo}]`,
            fetchRetryAttempts,
            fetchRetryDelayMs,
            () =>
              provider.getLogs({
                address: registryAddress,
                topics: [clearDelegateTopicLegacy, null, delegationIdTopic],
                fromBlock: currentFrom,
                toBlock: currentTo
              }),
            (attempt, err) => retryLog(attempt, err, "ClearDelegateLegacy")
          ),
          withRetry(
            `getLogs ClearDelegateIndexed [${currentFrom}-${currentTo}]`,
            fetchRetryAttempts,
            fetchRetryDelayMs,
            () =>
              provider.getLogs({
                address: registryAddress,
                topics: [clearDelegateTopicIndexed, null, delegationIdTopic],
                fromBlock: currentFrom,
                toBlock: currentTo
              }),
            (attempt, err) => retryLog(attempt, err, "ClearDelegateIndexed")
          )
        ]);

        for (const log of [...setLogs, ...clearLegacyLogs, ...clearIndexedLogs]) {
          uniqueDelegators.add(topicAddressToChecksum(log.topics[1]));
        }
      }
      verboseLog(`touched delegators count=${uniqueDelegators.size}`);

      const touchedDelegators = [...uniqueDelegators];
      const outdatedDelegators = [];
      if (canReadIndexedDelegate) {
        verboseLog("checking outdated delegators via getSpaceDelegate");
        for (const delegator of touchedDelegators) {
          try {
            const [registryDelegate, indexedDelegate] = await Promise.all([
              registry.delegation(delegator, space.delegationId),
              contract.getSpaceDelegate(spaceId, delegator)
            ]);
            if (String(registryDelegate).toLowerCase() !== String(indexedDelegate).toLowerCase()) {
              outdatedDelegators.push(delegator);
            }
          } catch {
            canReadIndexedDelegate = false;
            verboseLog("getSpaceDelegate not supported (or call failed), fallback to syncing all touched delegators");
            break;
          }
        }
      }
      if (!canReadIndexedDelegate) {
        outdatedDelegators.push(...touchedDelegators);
      }
      verboseLog(`outdated delegators count=${outdatedDelegators.length}`);

      let syncedCount = 0;
      let batchSyncComplete = true;
      const totalSyncBatches = Math.max(1, Math.ceil(outdatedDelegators.length / syncBatchSize));
      for (let i = 0; i < outdatedDelegators.length; i += syncBatchSize) {
        const batch = outdatedDelegators.slice(i, i + syncBatchSize);
        const batchIndex = Math.floor(i / syncBatchSize) + 1;
        verboseLog(`sync batch ${batchIndex}/${totalSyncBatches}, size=${batch.length}`);
        const { receipt, tx } = await runAndWait(
          `syncDelegationsForSpace batch ${batchIndex}/${totalSyncBatches}`,
          () => contract.syncDelegationsForSpace(spaceId, batch),
          provider,
          operationLog
        );
        verboseLog(`sync batch ${batchIndex} tx=${tx.hash}`);
        if (receipt?.status !== 1) {
          batchSyncComplete = false;
          verboseLog(`sync batch ${batchIndex} failed`);
          break;
        }
        syncedCount += batch.length;
      }
      verboseLog(`month synced=${syncedCount}/${outdatedDelegators.length}, complete=${batchSyncComplete}`);

      let checkpointUpdated = false;
      const canWriteCheckpointForMonth =
        monthRange.fromTs >= currentCheckpoint.fromTs && monthRange.toTs >= currentCheckpoint.toTs;
      if (!options["skip-checkpoint"] && isSpaceOwner && batchSyncComplete && canWriteCheckpointForMonth) {
        try {
          const { receipt, tx } = await runAndWait(
            `checkpoint update (${monthFromIso}..${monthToIso})`,
            () => contract.setSpaceDelegationSyncPeriod(spaceId, monthRange.fromTs, monthRange.toTs),
            provider,
            operationLog
          );
          checkpointUpdated = receipt?.status === 1;
          if (checkpointUpdated) {
            checkpointUpdates += 1;
            currentCheckpoint = { fromTs: monthRange.fromTs, toTs: monthRange.toTs };
            verboseLog(`checkpoint updated for month tx=${tx.hash}`);
          }
        } catch (err) {
          const details = formatDetailedError(err);
          throw new Error(
            `Checkpoint write failed for month ${monthFromIso}..${monthToIso} (spaceId=${spaceId.toString()}). ${details}`
          );
        }
      } else if (!options["skip-checkpoint"] && isSpaceOwner && batchSyncComplete && !canWriteCheckpointForMonth) {
        checkpointSkips += 1;
        verboseLog(
          `skip checkpoint for month ${monthFromIso}..${monthToIso}: non-monotonic vs current checkpoint fromTs=${currentCheckpoint.fromTs.toString()} toTs=${currentCheckpoint.toTs.toString()}`
        );
      }

      if (!batchSyncComplete) anySyncInterrupted = true;
      totalFoundDelegations += touchedDelegators.length;
      totalOutdatedDelegations += outdatedDelegators.length;
      totalSyncedDelegations += syncedCount;
      monthlyStats.push({
        fromTs: monthRange.fromTs.toString(),
        toTs: monthRange.toTs.toString(),
        fromBlock: monthFromBlock,
        toBlock: monthToBlock,
        foundDelegations: touchedDelegators.length,
        outdatedDelegations: outdatedDelegators.length,
        syncedDelegations: syncedCount,
        checkpointUpdated
      });
      verboseLog(
        `month done found=${touchedDelegators.length} outdated=${outdatedDelegators.length} synced=${syncedCount} checkpointUpdated=${checkpointUpdated}`
      );
    }
    verboseLog(
      `finished totals found=${totalFoundDelegations} outdated=${totalOutdatedDelegations} synced=${totalSyncedDelegations} checkpointUpdates=${checkpointUpdates} interrupted=${anySyncInterrupted}`
    );

    printOutput(
      {
        message: anySyncInterrupted
          ? "Delegation sync interrupted before all monthly batches completed"
          : "Delegation sync completed",
        rangeSource: checkpointExists ? "checkpoint-plus-days" : "default-start-plus-days",
        defaultStartDate: "2021-11-01",
        days: windowDays,
        checkpointFromTs: cpFromTs.toString(),
        checkpointToTs: cpToTs.toString(),
        monthlyRangesProcessed: monthlyRanges.length,
        checkpointUpdates,
        checkpointSkips,
        indexedDelegateReadSupported: canReadIndexedDelegate,
        checkpointWriteSupported: true,
        spaceId: spaceId.toString(),
        fromTs: fromTs.toString(),
        toTs: toTs.toString(),
        fetchBatchSize,
        syncBatchSize,
        foundDelegations: totalFoundDelegations,
        outdatedDelegations: totalOutdatedDelegations,
        syncedDelegations: totalSyncedDelegations,
        months: asJson ? monthlyStats : monthlyStats.length
      },
      asJson
    );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error("voting-cli error:", err.message);
  process.exit(1);
});
