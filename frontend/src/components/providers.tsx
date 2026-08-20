"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } from "@web3auth/modal";
import { Web3AuthProvider } from "@web3auth/modal/react";
import { WagmiProvider } from "@web3auth/modal/react/wagmi";
import { useState, type ReactNode } from "react";
import {
  AuthProvider,
  AuthUnconfiguredProvider,
} from "@/components/auth/auth-provider";

const chainId = Number(process.env.NEXT_PUBLIC_PAYMENT_CHAIN_ID ?? 137);
const chainIdHex = `0x${chainId.toString(16)}`;
const rpcUrl =
  process.env.NEXT_PUBLIC_PAYMENT_RPC_URL ?? "https://polygon-rpc.com";

/**
 * アプリ全体のプロバイダ。Web3Auth Modal は「ソーシャルログイン(Google /
 * Discord / X)」と「外部ウォレット接続」の両入口を1つのモーダルで提供する。
 * ログイン完了の判定は Web3Auth ではなく、backend の SIWE 検証
 * (/api/v1/wallet-auth/*)で行う。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;

  if (!clientId) {
    // Client ID未設定でも公開画面(LP・一覧)は閲覧できるようにする
    return (
      <QueryClientProvider client={queryClient}>
        <AuthUnconfiguredProvider>{children}</AuthUnconfiguredProvider>
      </QueryClientProvider>
    );
  }

  const config = {
    web3AuthOptions: {
      clientId,
      web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
      chains: [
        {
          chainNamespace: CHAIN_NAMESPACES.EIP155,
          chainId: chainIdHex,
          rpcTarget: rpcUrl,
          displayName: process.env.NEXT_PUBLIC_PAYMENT_CHAIN_NAME ?? "Polygon",
          blockExplorerUrl:
            process.env.NEXT_PUBLIC_PAYMENT_EXPLORER_URL ||
            "https://polygonscan.com",
          ticker: chainId === 137 ? "POL" : "ETH",
          tickerName:
            chainId === 137 ? "Polygon Ecosystem Token" : "Local Ether",
          logo: "https://images.web3auth.io/login-polygon.svg",
          decimals: 18,
          isTestnet: chainId !== 137,
        },
      ],
      defaultChainId: chainIdHex,
      uiConfig: {
        appName: "Trustca",
        mode: "light" as const,
        defaultLanguage: "ja" as const,
      },
    },
  };

  return (
    <Web3AuthProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider>
          <AuthProvider>{children}</AuthProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </Web3AuthProvider>
  );
}
