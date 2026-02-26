#!/usr/bin/env node
import { Command } from "commander";
import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";
import { votingAbi } from "./abi.js";

dotenvConfig();

function getRpcUrl(opts) {
  return opts.rpcUrl || process.env.CLI_RPC_URL || "http://127.0.0.1:8545";
}

function getContractAddress(opts) {
  const value = opts.contract || process.env.CLI_CONTRACT;
  if (!value) {
    throw new Error("Missing --contract and CLI_CONTRACT");
  }
  return value;
}

function getProvider(opts) {
  return new ethers.JsonRpcProvider(getRpcUrl(opts));
}

function getSigner(opts) {
  if (!opts.privateKey) {
    throw new Error("Missing --private-key");
  }
  return new ethers.Wallet(opts.privateKey, getProvider(opts));
}

function printOutput(payload, asJson) {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    Object.entries(payload).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
    });
  }
}

const program = new Command();
program.name("tetu-vote");

program
  .command("proposal:create")
  .requiredOption("--space-id <id>")
  .requiredOption("--title <title>")
  .requiredOption("--description <description>")
  .requiredOption("--options <options>")
  .requiredOption("--start-at <startAt>")
  .requiredOption("--end-at <endAt>")
  .option("--allow-multi")
  .requiredOption("--private-key <privateKey>")
  .option("--rpc-url <rpcUrl>")
  .option("--contract <contract>")
  .option("--json")
  .action(async (opts) => {
    const signer = getSigner(opts);
    const contract = new ethers.Contract(getContractAddress(opts), votingAbi, signer);
    const parsedOptions = String(opts.options)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const tx = await contract.createProposal(
      BigInt(opts.spaceId),
      opts.title,
      opts.description,
      parsedOptions,
      BigInt(opts.startAt),
      BigInt(opts.endAt),
      Boolean(opts.allowMulti)
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

    printOutput(
      {
        txHash: tx.hash,
        proposalId,
        message: `Proposal ${proposalId} created`
      },
      Boolean(opts.json)
    );
  });

program
  .command("vote:cast")
  .requiredOption("--proposal-id <proposalId>")
  .requiredOption("--option <option>")
  .requiredOption("--private-key <privateKey>")
  .option("--rpc-url <rpcUrl>")
  .option("--contract <contract>")
  .option("--json")
  .action(async (opts) => {
    const signer = getSigner(opts);
    const contract = new ethers.Contract(getContractAddress(opts), votingAbi, signer);
    const before = await contract.getVoteReceipt(BigInt(opts.proposalId), signer.address);
    const wasFirstVote = !before.hasVoted;
    const tx = await contract.vote(BigInt(opts.proposalId), [Number(opts.option)], [10000]);
    await tx.wait();
    const after = await contract.getVoteReceipt(BigInt(opts.proposalId), signer.address);

    printOutput(
      {
        txHash: tx.hash,
        mode: wasFirstVote ? "first-vote" : "re-vote",
        effectiveWeight: after.weight.toString()
      },
      Boolean(opts.json)
    );
  });

program
  .command("results:read")
  .requiredOption("--proposal-id <proposalId>")
  .option("--rpc-url <rpcUrl>")
  .option("--contract <contract>")
  .option("--json")
  .action(async (opts) => {
    const provider = getProvider(opts);
    const contract = new ethers.Contract(getContractAddress(opts), votingAbi, provider);
    const proposal = await contract.getProposal(BigInt(opts.proposalId));
    const [options, tallies] = await contract.getProposalTallies(BigInt(opts.proposalId));
    const now = BigInt(Math.floor(Date.now() / 1000));
    const status = proposal.deleted ? "deleted" : now >= proposal.endAt ? "ended" : "active";

    const payload = {
      proposalId: proposal.id.toString(),
      title: proposal.title,
      description: proposal.description,
      status,
      options: options.map((option, i) => ({
        option,
        tally: tallies[i].toString()
      }))
    };
    printOutput(payload, Boolean(opts.json));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("CLI error:", err.message);
  process.exit(1);
});
