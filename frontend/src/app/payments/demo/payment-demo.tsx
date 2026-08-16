"use client";

import {
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
} from "@web3auth/modal/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits, getAddress, type Address, type Hash } from "viem";
import { useConnection, useSignMessage, useWriteContract } from "wagmi";
import styles from "./payment-demo.module.css";

const backendUrl =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";
const expectedChainId = Number(
  process.env.NEXT_PUBLIC_PAYMENT_CHAIN_ID ?? 137,
);

const jpycAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type PaymentIntent = {
  id: string;
  orderId: string;
  status: "created" | "submitted" | "confirmed" | "failed" | "expired";
  chainId: number;
  tokenAddress: Address;
  fromAddress: Address;
  toAddress: Address;
  amountAtomic: string;
  tokenDecimals: number;
  txHash: Hash | null;
  blockNumber: string | null;
  expiresAt: string;
  lastErrorCode: string | null;
};

type ApiResult<T> = { data: T } | { error: { code: string; message: string } };

async function api<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as ApiResult<T>;
  if (!response.ok || "error" in body) {
    throw new Error(
      "error" in body ? body.error.message : "API処理に失敗しました。",
    );
  }
  return body.data;
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 7)}…${address.slice(-5)}` : "未接続";
}

export function PaymentDemo() {
  const connection = useConnection();
  const { connect, loading: connecting } = useWeb3AuthConnect();
  const { disconnect, loading: disconnecting } = useWeb3AuthDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [session, setSession] = useState<{
    token: string;
    walletAddress: Address;
    chainId: number;
  } | null>(null);
  const [orderId, setOrderId] = useState("");
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("ウォレット接続から開始してください。");
  const activeSession =
    session &&
    connection.status === "connected" &&
    connection.address?.toLowerCase() === session.walletAddress.toLowerCase() &&
    connection.chainId === session.chainId
      ? session
      : null;

  useEffect(() => {
    if (!intent || intent.status !== "submitted" || !activeSession) return;
    const timer = window.setInterval(async () => {
      try {
        const current = await api<PaymentIntent>(
          `/api/v1/payments/${intent.id}`,
          {},
          activeSession.token,
        );
        setIntent(current);
        if (current.status === "confirmed") {
          setNotice("入金を確認しました。取引状態を更新済みです。");
        } else if (current.status === "failed") {
          setNotice("入金内容を確認できませんでした。詳細を確認してください。");
        }
      } catch {
        setNotice("確認状態を取得できません。自動的に再試行します。");
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [intent, activeSession]);

  async function connectWallet() {
    try {
      await connect();
      setNotice("walletを接続しました。続いて署名で管理権限を確認します。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "wallet接続に失敗しました。");
    }
  }

  async function authenticate() {
    if (!connection.address || !connection.chainId) {
      setNotice("先にウォレットを接続してください。");
      return;
    }
    if (connection.chainId !== expectedChainId) {
      setNotice(`chain ID ${expectedChainId}へ切り替えてください。`);
      return;
    }
    setBusy(true);
    try {
      const challenge = await api<{
        challengeId: string;
        message: string;
      }>("/api/v1/wallet-auth/challenges", {
        method: "POST",
        body: JSON.stringify({
          address: connection.address,
          chainId: connection.chainId,
        }),
      });
      const signature = await signMessageAsync({ message: challenge.message });
      const verified = await api<{
        token: string;
        walletAddress: Address;
        chainId: number;
      }>(
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
      setIntent(null);
      setNotice("署名を確認しました。sessionはこの画面のmemory内だけに保持します。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "署名認証に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function createIntent() {
    if (!activeSession) return;
    setBusy(true);
    try {
      const created = await api<PaymentIntent>(
        "/api/v1/payments",
        { method: "POST", body: JSON.stringify({ orderId }) },
        activeSession.token,
      );
      setIntent(created);
      setNotice("支払条件を固定しました。受取先と金額を確認してください。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "支払条件を取得できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!intent || !activeSession) return;
    if (
      connection.status !== "connected" ||
      connection.address?.toLowerCase() !== intent.fromAddress.toLowerCase() ||
      connection.chainId !== intent.chainId
    ) {
      setNotice("支払条件と同じwallet・chainへ接続し直してください。");
      return;
    }
    setBusy(true);
    try {
      const txHash = await writeContractAsync({
        address: getAddress(intent.tokenAddress),
        abi: jpycAbi,
        functionName: "transfer",
        args: [getAddress(intent.toAddress), BigInt(intent.amountAtomic)],
        chainId: intent.chainId,
      });
      const submitted = await api<PaymentIntent>(
        `/api/v1/payments/${intent.id}/submissions`,
        { method: "POST", body: JSON.stringify({ txHash }) },
        activeSession.token,
      );
      setIntent(submitted);
      setNotice("transactionを受け付けました。chain上の確定を確認しています。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "JPYC送金に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    try {
      await disconnect({ cleanup: true });
    } finally {
      setSession(null);
      setIntent(null);
      setNotice("ウォレット接続とTrustca sessionを終了しました。");
    }
  }

  const amount = intent
    ? formatUnits(BigInt(intent.amountAtomic), intent.tokenDecimals)
    : "—";
  const connected = connection.status === "connected";
  const steps = [connected, Boolean(activeSession), Boolean(intent), intent?.status === "confirmed"];

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark}>TRUSTCA</Link>
        <span className={styles.environment}>JPYC PAYMENT / MVP</span>
      </header>

      <section className={styles.intro}>
        <p className={styles.kicker}>取引番号に、支払いの根拠を結び付ける</p>
        <h1>確認できる送金。<br />曖昧にしない取引。</h1>
        <p className={styles.lead}>
          署名でwalletの管理権限を確かめ、注文ごとに固定したJPYC送金だけを
          chain上の記録から非同期に確認します。
        </p>
      </section>

      <div className={styles.ledger}>
        <ol className={styles.progress} aria-label="決済手順">
          {["接続", "署名", "送金", "確定"].map((label, index) => (
            <li key={label} className={steps[index] ? styles.done : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>{label}
            </li>
          ))}
        </ol>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.label}>WALLET</p>
              <h2>署名者を確認</h2>
            </div>
            <span className={connected ? styles.statusOn : styles.statusOff}>
              {connected ? "接続済み" : "未接続"}
            </span>
          </div>
          <dl className={styles.facts}>
            <div><dt>アドレス</dt><dd>{shortAddress(connection.address)}</dd></div>
            <div><dt>chain ID</dt><dd>{connection.chainId ?? "—"}</dd></div>
            <div><dt>Trustca session</dt><dd>{activeSession ? "署名確認済み" : session ? "wallet変更・再認証が必要" : "未認証"}</dd></div>
          </dl>
          <div className={styles.actions}>
            {!connected ? (
              <button onClick={() => void connectWallet()} disabled={connecting}>ウォレットを接続</button>
            ) : !activeSession ? (
              <button onClick={() => void authenticate()} disabled={busy}>メッセージに署名</button>
            ) : (
              <button className={styles.secondary} onClick={() => void closeSession()} disabled={disconnecting}>接続を終了</button>
            )}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><p className={styles.label}>ORDER</p><h2>支払条件を照合</h2></div>
            <span className={styles.seal}>JPYC</span>
          </div>
          <label className={styles.orderField}>
            注文ID
            <input
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              disabled={!activeSession || Boolean(intent)}
            />
          </label>
          {!intent ? (
            <button onClick={() => void createIntent()} disabled={!activeSession || !orderId || busy}>支払条件を取得</button>
          ) : (
            <div className={styles.receipt}>
              <div className={styles.amount}><span>支払額</span><strong>{amount}</strong><em>JPYC</em></div>
              <dl className={styles.facts}>
                <div><dt>受取先</dt><dd>{shortAddress(intent.toAddress)}</dd></div>
                <div><dt>token</dt><dd>{shortAddress(intent.tokenAddress)}</dd></div>
                <div><dt>有効期限</dt><dd>{new Date(intent.expiresAt).toLocaleString("ja-JP")}</dd></div>
                <div><dt>状態</dt><dd>{intent.status}</dd></div>
                {intent.blockNumber && <div><dt>block</dt><dd>{intent.blockNumber}</dd></div>}
              </dl>
              {intent.status === "created" && (
                <button className={styles.payButton} onClick={() => void pay()} disabled={busy}>内容を確認してJPYCを送る</button>
              )}
            </div>
          )}
        </section>
      </div>

      <aside className={styles.notice} aria-live="polite">
        <span>処理メモ</span><p>{notice}</p>
      </aside>
      <footer className={styles.footer}>
        本画面はMVP検証用です。送金前にchain・token contract・受取先・金額を必ず確認してください。
      </footer>
    </main>
  );
}
