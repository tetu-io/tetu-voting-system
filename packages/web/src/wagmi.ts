import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { getConfiguredChain } from "./config/chain";

const useMock = import.meta.env.VITE_USE_MOCK === "true";
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const rpcUrl = useMock ? "http://127.0.0.1:8545" : (import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545");
const configuredChain = getConfiguredChain(chainId, rpcUrl);
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

const connectors = walletConnectProjectId
  ? connectorsForWallets(
      [
        {
          groupName: "Recommended",
          wallets: [
            rainbowWallet({ projectId: walletConnectProjectId, chains: [configuredChain] }),
            walletConnectWallet({ projectId: walletConnectProjectId, chains: [configuredChain] })
          ]
        }
      ],
      {
        appName: "Tetu Voting",
        appDescription: "Tetu voting frontend"
      }
    )
  : [];

export const config = createConfig({
  chains: [configuredChain],
  connectors,
  transports: {
    [configuredChain.id]: http(rpcUrl)
  }
});
