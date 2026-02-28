import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { getConfiguredChain } from "./config/chain";

const useMock = import.meta.env.VITE_USE_MOCK === "true";
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const enableTestWalletUi = import.meta.env.VITE_ENABLE_TEST_WALLET_LOGIN === "true";
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
const useInternalRpc = useMock || enableTestWalletUi || Boolean(walletConnectProjectId);
const rpcUrl = useInternalRpc ? (import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545") : undefined;
const configuredChain = getConfiguredChain(chainId, rpcUrl);
const rpcTimeoutMs = 600_000;

const connectors = walletConnectProjectId
  ? connectorsForWallets(
      [
        {
          groupName: "Popular",
          wallets: [metaMaskWallet, rabbyWallet, walletConnectWallet]
        }
      ],
      {
        projectId: walletConnectProjectId,
        appName: "Tetu Voting",
        appDescription: "Tetu voting frontend"
      }
    )
  : [];

export const config = createConfig({
  chains: [configuredChain],
  connectors,
  transports: {
    [configuredChain.id]: rpcUrl ? http(rpcUrl, { timeout: rpcTimeoutMs }) : http(undefined, { timeout: rpcTimeoutMs })
  }
});
