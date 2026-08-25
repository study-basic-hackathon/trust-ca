"use client";

import {
  useWeb3Auth,
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
import {
  buildKernelContext,
  clearActiveKernel,
  getActiveKernel,
  isAaEnabled,
} from "@/lib/aa/kernel-client";
import { api, ApiError } from "@/lib/api";
import { useAuthStore, type AuthSession } from "@/lib/stores/auth-store";

const expectedChainId = Number(process.env.NEXT_PUBLIC_PAYMENT_CHAIN_ID ?? 137);

/** ソーシャルログイン(Web3Auth組込みwallet)のconnector名 */
const SOCIAL_CONNECTOR_NAME = "auth";

export type PaymentMode = "aa" | "eoa";

type Signer = {
  address: Address;
  chainId: number;
  mode: PaymentMode;
  signMessage: (message: string) => Promise<`0x${string}`>;
};

type AuthContextValue = {
  /** Trustca session(SIWE検証済み)。wallet接続だけでは null のまま */
  session: AuthSession | null;
  isSignedIn: boolean;
  isBusy: boolean;
  walletAddress: Address | undefined;
  /**
   * 支払い経路。ソーシャルログイン+ZeroDev設定時は smart account(gasless)、
   * 外部walletは従来のEOA直接送金。
   */
  paymentMode: PaymentMode;
  /** モーダル起動 → wallet接続 → SIWE署名 → session発行 までを一括実行 */
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const connection = useConnection();
  const { web3Auth } = useWeb3Auth();
  const {
    connect,
    connectorName,
    loading: connecting,
  } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { status, session, setStatus, setSession, clear } = useAuthStore();

  // sessionの有効性: 接続中かつ、sessionのwalletが
  // (a) 接続walletそのもの(EOA)、または (b) 接続wallet(owner)から導出した
  // smart account、のいずれかに一致していること
  const kernel = getActiveKernel();
  const isSessionBackedByConnection =
    session !== null &&
    connection.status === "connected" &&
    connection.chainId === session.chainId &&
    (connection.address?.toLowerCase() === session.walletAddress.toLowerCase() ||
      (kernel !== null &&
        kernel.ownerAddress.toLowerCase() ===
          connection.address?.toLowerCase() &&
        kernel.aaAddress.toLowerCase() ===
          session.walletAddress.toLowerCase()));
  const activeSession = isSessionBackedByConnection ? session : null;

  const resolveSigner = useCallback(async (): Promise<Signer | null> => {
    let provider: EIP1193Provider | null = null;
    let resolvedConnectorName: string | null = connectorName;

    if (connection.status === "connected" && connection.address) {
      provider = (web3Auth?.provider as EIP1193Provider | null) ?? null;
    } else {
      // 未接続: Web3Authモーダル(ソーシャル/外部walletの両入口)を開く
      const connected = await connect();
      if (!connected?.ethereumProvider) return null; // モーダルを閉じた
      provider = connected.ethereumProvider as EIP1193Provider;
      resolvedConnectorName = connected.connectorName;
    }

    // ソーシャルログイン + ZeroDev設定あり → smart account(gasless)経路
    if (
      provider &&
      resolvedConnectorName === SOCIAL_CONNECTOR_NAME &&
      isAaEnabled()
    ) {
      const kernelContext = await buildKernelContext(provider);
      return {
        address: kernelContext.aaAddress,
        chainId: expectedChainId,
        mode: "aa",
        signMessage: kernelContext.signMessage,
      };
    }

    // EOA経路(外部wallet、またはZeroDev未設定時のソーシャル)
    if (connection.status === "connected" && connection.address) {
      return {
        address: connection.address as Address,
        chainId: connection.chainId ?? 0,
        mode: "eoa",
        signMessage: (message) => signMessageAsync({ message }),
      };
    }
    if (!provider) return null;
    const walletClient = createWalletClient({ transport: custom(provider) });
    const [address] = await walletClient.getAddresses();
    if (!address) return null;
    return {
      address,
      chainId: await walletClient.getChainId(),
      mode: "eoa",
      signMessage: (message) =>
        walletClient.signMessage({ account: address, message }),
    };
  }, [
    connect,
    connection.address,
    connection.chainId,
    connection.status,
    connectorName,
    signMessageAsync,
    web3Auth,
  ]);

  const login = useCallback(async () => {
    let signer: Signer | null;
    try {
      signer = await resolveSigner();
    } catch (error) {
      console.error("signerの初期化に失敗しました", error);
      toast.error("ウォレットの初期化に失敗しました。再度お試しください");
      return;
    }
    if (!signer) return;
    if (signer.chainId !== expectedChainId) {
      toast.error(
        `ネットワークをchain ID ${expectedChainId}へ切り替えてください`,
      );
      return;
    }

    // SIWE: backend発行のchallengeへ署名し、検証結果のsessionだけを信用する。
    // smart accountの署名はbackendがERC-1271/6492としてchain上で検証する
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
      toast.success(
        signer.mode === "aa"
          ? "ログインしました(ガス代不要のスマートアカウントを使用します)"
          : "ログインしました",
      );
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
      clearActiveKernel();
      clear();
      toast("ログアウトしました");
    }
  }, [clear, disconnect]);

  // kernelはReact外のモジュールキャッシュのためuseMemoの依存にできない。
  // context値は毎renderで再構築する(認証状態の変化時のみ購読側が再描画される)
  const value: AuthContextValue = {
    session: activeSession,
    isSignedIn: Boolean(activeSession),
    isBusy: connecting || status === "signing",
    walletAddress:
      (activeSession?.walletAddress as Address | undefined) ??
      (connection.address as Address | undefined),
    paymentMode:
      activeSession && kernel &&
      kernel.aaAddress.toLowerCase() ===
        activeSession.walletAddress.toLowerCase()
        ? "aa"
        : "eoa",
    login,
    logout,
  };

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
      paymentMode: "eoa",
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
