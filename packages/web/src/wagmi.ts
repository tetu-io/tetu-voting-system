import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

const useMock = import.meta.env.VITE_USE_MOCK === "true";
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const rpcUrl = useMock ? "http://127.0.0.1:8545" : (import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545");

const hardhat = defineChain({
  id: chainId,
  name: "Hardhat Local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});

export const config = createConfig({
  chains: [hardhat],
  connectors: [injected()],
  transports: {
    [hardhat.id]: http(rpcUrl)
  }
});
