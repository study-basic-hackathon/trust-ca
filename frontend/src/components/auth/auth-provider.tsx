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
  useEffect,
  useMemo,
  useState,
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

  // sessionはsessionStorageに永続化され、リロード・eKYC等の外部リダイレクト後も
  // 維持される(有効性=JWT expはstore側で検証済み)。以前は「接続中のwalletと一致」を
  // ログイン状態の条件にしていたが、これだとリロード直後(wallet再接続前)や
  // eKYC復帰時にログアウト扱いになり実用に耐えなかった。認証の実体はbackend発行の
  // sessionトークンであり、wallet接続はログイン状態の必要条件ではない。実際に署名が
  // 要る操作(支払い)は payment panel 側で接続・kernelを個別に検証する。
  // kernelはReact外のmodule cache。再構築後に支払いモードを再評価させるための再描画トリガ
  const [kernelEpoch, setKernelEpoch] = useState(0);
  void kernelEpoch;
  const kernel = getActiveKernel();
  const activeSession = session;

  // リロードでmodule内kernelキャッシュは失われる。ソーシャルログイン(AA)の
  // sessionが復元され、web3Authが同じownerで再接続できたらkernelを再構築し、
  // リロード後もAA(ガス不要)での支払いを継続できるようにする。
  useEffect(() => {
    const provider = web3Auth?.provider as EIP1193Provider | null | undefined;
    if (
      !provider ||
      !session ||
      !isAaEnabled() ||
      connection.status !== "connected" ||
      getActiveKernel() !== null ||
      web3Auth?.primaryConnectorName !== SOCIAL_CONNECTOR_NAME
    ) {
      return;
    }
    let cancelled = false;
    void buildKernelContext(provider)
      .then(() => {
        // kernel再構築完了 → paymentMode等を再評価させるため再描画する
        if (!cancelled) setKernelEpoch((n) => n + 1);
      })
      .catch(() => {
        // 再構築失敗時は支払い時に再ログインを促すため、ここでは握りつぶす
      });
    return () => {
      cancelled = true;
    };
  }, [web3Auth, connection.status, session]);

  const resolveSigner = useCallback(async (): Promise<Signer | null> => {
    let provider: EIP1193Provider | null = null;
    let resolvedConnectorName: string | null = null;

    if (connection.status === "connected" && connection.address) {
      provider = (web3Auth?.provider as EIP1193Provider | null) ?? null;
    } else {
      // 未接続: Web3Authモーダル(ソーシャル/外部walletの両入口)を開く
      const connected = await connect();
      if (!connected?.ethereumProvider) return null; // モーダルを閉じた
      provider = connected.ethereumProvider as EIP1193Provider;
      resolvedConnectorName = connected.connectorName;
    }

    // 接続中のconnectorはweb3Auth.primaryConnectorNameが権威(reconnect後も保持)。
    // hookのconnectorNameはuseEffect経由で非同期設定されるためrace的にnullに
    // なりうる。これに依存するとリロード後の再ログインでソーシャルでもEOA経路に
    // 落ち、AAアドレスと異なる別ユーザーになってしまう(注文が孤立し404/403)。
    resolvedConnectorName =
      resolvedConnectorName ??
      web3Auth?.primaryConnectorName ??
      connectorName;

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
