"use client";

import {
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
} from "@web3auth/modal/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
} from "viem";
import { useConnection, useSignMessage } from "wagmi";
import { api, ApiError } from "@/lib/api";
import { useAuthStore, type AuthSession } from "@/lib/stores/auth-store";

const expectedChainId = Number(process.env.NEXT_PUBLIC_PAYMENT_CHAIN_ID ?? 137);

type Signer = {
  address: Address;
  chainId: number;
  signMessage: (message: string) => Promise<`0x${string}`>;
};

type AuthContextValue = {
  /** Trustca session(SIWE検証済み)。wallet接続だけでは null のまま */
  session: AuthSession | null;
  isSignedIn: boolean;
  isBusy: boolean;
  walletAddress: Address | undefined;
  /** モーダル起動 → wallet接続 → SIWE署名 → session発行 までを一括実行 */
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const connection = useConnection();
  const { connect, loading: connecting } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { status, session, setStatus, setSession, clear } = useAuthStore();

  // wallet・chainがsessionと一致している場合のみ有効なsessionとして扱う
  const activeSession =
    session &&
    connection.status === "connected" &&
    connection.address?.toLowerCase() === session.walletAddress.toLowerCase() &&
    connection.chainId === session.chainId
      ? session
      : null;

  const resolveSigner = useCallback(async (): Promise<Signer | null> => {
    if (connection.status === "connected" && connection.address) {
      // 接続済み: wagmi経由で署名する
      return {
        address: connection.address as Address,
        chainId: connection.chainId ?? 0,
        signMessage: (message) => signMessageAsync({ message }),
      };
    }
    // 未接続: Web3Authモーダル(ソーシャル/外部walletの両入口)を開き、
    // 返却されたproviderから直接アドレスを取得する(wagmi状態の反映を待たない)
    const connected = await connect();
    const provider = connected?.ethereumProvider as EIP1193Provider | null;
    if (!provider) return null; // ユーザーがモーダルを閉じた
    const walletClient = createWalletClient({ transport: custom(provider) });
    const [address] = await walletClient.getAddresses();
    if (!address) return null;
    return {
      address,
      chainId: await walletClient.getChainId(),
      signMessage: (message) =>
        walletClient.signMessage({ account: address, message }),
    };
  }, [connect, connection.address, connection.chainId, connection.status, signMessageAsync]);

  const login = useCallback(async () => {
    const signer = await resolveSigner();
    if (!signer) return;
    if (signer.chainId !== expectedChainId) {
      toast.error(
        `ネットワークをchain ID ${expectedChainId}へ切り替えてください`,
      );
      return;
    }

    // SIWE: backend発行のchallengeへ署名し、検証結果のsessionだけを信用する
    setStatus("signing");
    try {
      const challenge = await api<{ challengeId: string; message: string }>(
        "/api/v1/wallet-auth/challenges",
        {
          method: "POST",
          body: JSON.stringify({
            address: signer.address,
            chainId: signer.chainId,
          }),
        },
      );
      const signature = await signer.signMessage(challenge.message);
      const verified = await api<AuthSession>(
        "/api/v1/wallet-auth/verifications",
        {
          method: "POST",
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            message: challenge.message,
            signature,
          }),
        },
      );
      setSession(verified);
      toast.success("ログインしました");
    } catch (error) {
      setStatus("connected");
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("署名がキャンセルされました。ログインには署名が必要です");
      }
    }
  }, [resolveSigner, setSession, setStatus]);

  const logout = useCallback(async () => {
    try {
      await disconnect({ cleanup: true });
    } finally {
      clear();
      toast("ログアウトしました");
    }
  }, [clear, disconnect]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session: activeSession,
      isSignedIn: Boolean(activeSession),
      isBusy: connecting || status === "signing",
      walletAddress: connection.address as Address | undefined,
      login,
      logout,
    }),
    [activeSession, connecting, connection.address, login, logout, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * NEXT_PUBLIC_WEB3AUTH_CLIENT_ID未設定時のフォールバック。
 * 公開画面の閲覧は許可し、ログイン操作には設定不足を案内する。
 */
export function AuthUnconfiguredProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useMemo<AuthContextValue>(
    () => ({
      session: null,
      isSignedIn: false,
      isBusy: false,
      walletAddress: undefined,
      login: async () => {
        toast.error(
          "認証機能が設定されていません。NEXT_PUBLIC_WEB3AUTH_CLIENT_IDを設定してください",
        );
      },
      logout: async () => {},
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuthはAppProviders配下でのみ使用できます");
  }
  return value;
}
