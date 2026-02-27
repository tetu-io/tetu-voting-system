import { defineChain, type Chain } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  hardhat,
  localhost,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia
} from "viem/chains";

const knownChains: Chain[] = [
  mainnet,
  sepolia,
  polygon,
  polygonAmoy,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  base,
  baseSepolia,
  hardhat,
  localhost
];

function overrideRpc(chain: Chain, rpcUrl: string): Chain {
  return defineChain({
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });
}

function findKnownChain(chainId: number): Chain | undefined {
  return knownChains.find((item) => item.id === chainId);
}

export function getConfiguredChain(chainId: number, rpcUrl?: string): Chain {
  const known = findKnownChain(chainId);
  if (known) return rpcUrl ? overrideRpc(known, rpcUrl) : known;
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: rpcUrl
      ? { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } }
      : { default: { http: [] }, public: { http: [] } }
  });
}

export function getChainDisplayName(chainId: number): string {
  return findKnownChain(chainId)?.name ?? `Chain ${chainId}`;
}
