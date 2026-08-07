"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocalStorageValue } from "@/hooks/useLocalStorageValue";
import { FlowStepper } from "@/components/FlowStepper";
import { EventTimeline } from "@/components/EventTimeline";
import type {
  FlowStepView,
  VerificationEventView,
} from "@/components/flowTypes";

type KycChecks = {
  document: string;
  liveness: string;
  faceMatch: string;
  ipAnalysis: string;
};

type StatusData = {
  seller: { id: string; displayName: string };
  verification: {
    sessionId: string;
    status: string;
    checks: KycChecks | null;
    source: string;
    updatedAt: string;
  } | null;
  isSellingAllowed: boolean;
  flowSteps: FlowStepView[];
  events: VerificationEventView[];
};

type WebhookLog = {
  id: number;
  sessionId: string;
  status: string;
  signatureMethod: string | null;
  isSignatureValid: boolean;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "未開始",
  in_progress: "確認中",
  in_review: "審査中(人力確認)",
  approved: "本人確認済み",
  declined: "否認",
  abandoned: "中断",
  expired: "期限切れ",
};

const CHECK_LABELS: Record<string, string> = {
  document: "本人確認書類",
  liveness: "ライブネス",
  faceMatch: "顔照合",
  ipAnalysis: "IP分析",
};

const CHECK_RESULT_LABELS: Record<string, string> = {
  passed: "✅ 合格",
  failed: "❌ 不合格",
  in_review: "🔍 審査中",
  not_run: "— 未実施",
};

const POLL_INTERVAL_MS = 5000;
const SELLER_ID_STORAGE_KEY = "trust-ca:sellerId";

export default function Home() {
  const [sellerId, setSellerId] = useLocalStorageValue(SELLER_ID_STORAGE_KEY);
  const [displayName, setDisplayName] = useState("");
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(
    async (id: string, refresh: boolean) => {
      try {
        const res = await fetch(
          `/api/kyc/status?sellerId=${encodeURIComponent(id)}${refresh ? "&refresh=1" : ""}`,
        );
        const json = await res.json();
        if (!res.ok || !json.success) {
          if (res.status === 404) {
            setSellerId(null);
            return;
          }
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        setStatusData(json.data as StatusData);
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "ステータス取得に失敗しました",
        );
      }
      try {
        const res = await fetch("/api/webhook-logs");
        const json = await res.json();
        if (json.success) setWebhookLogs(json.data as WebhookLog[]);
      } catch {
        // Webhook logs are auxiliary; ignore failures.
      }
    },
    [setSellerId],
  );

  useEffect(() => {
    if (!sellerId) return;
    // Defer past the commit so state updates never happen inside the effect.
    const timer = setTimeout(() => fetchStatus(sellerId, false), 0);
    return () => clearTimeout(timer);
  }, [sellerId, fetchStatus]);

  const verificationStatus = statusData?.verification?.status;

  useEffect(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    const isPollingNeeded =
      sellerId &&
      verificationStatus &&
      ["not_started", "in_progress"].includes(verificationStatus);
    if (isPollingNeeded) {
      pollTimer.current = setInterval(
        () => fetchStatus(sellerId, true),
        POLL_INTERVAL_MS,
      );
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [sellerId, verificationStatus, fetchStatus]);

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/sellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "登録に失敗しました");
      }
      setSellerId(json.data.id);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "登録に失敗しました",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStartKyc() {
    if (!sellerId) return;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/kyc/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "セッション作成に失敗しました");
      }
      window.location.href = json.data.sessionUrl as string;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "セッション作成に失敗しました",
      );
      setIsBusy(false);
    }
  }

  function handleReset() {
    setSellerId(null);
    setStatusData(null);
  }

  return (
    <main className="container">
      <h1>Trust-CA: 販売者 eKYC 検証</h1>
      <p className="subtitle">
        Didit本番APIによる本人確認フローの実験実装(ローカル検証用)
      </p>

      {errorMessage && <div className="error-box">{errorMessage}</div>}

      {!sellerId ? (
        <form onSubmit={handleRegister} className="card">
          <h2>販売者登録</h2>
          <label htmlFor="displayName">表示名</label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: moose"
            maxLength={100}
            required
          />
          <button type="submit" disabled={isBusy}>
            {isBusy ? "登録中..." : "登録する"}
          </button>
        </form>
      ) : (
        <>
          <section className="card">
            <h2>
              {statusData?.seller.displayName ?? "..."}
              {statusData?.isSellingAllowed && (
                <span className="badge badge-approved">本人確認済み</span>
              )}
            </h2>
            <p className="muted">seller_id: {sellerId}</p>

            {statusData && <FlowStepper steps={statusData.flowSteps} />}

            {statusData?.verification ? (
              <>
                <div
                  className={`status status-${statusData.verification.status}`}
                >
                  {STATUS_LABELS[statusData.verification.status] ??
                    statusData.verification.status}
                </div>
                <p className="muted">
                  最終更新: {statusData.verification.updatedAt} UTC(取得元:{" "}
                  {statusData.verification.source})
                </p>
                {statusData.verification.checks && (
                  <table className="checks">
                    <tbody>
                      {Object.entries(statusData.verification.checks).map(
                        ([key, value]) => (
                          <tr key={key}>
                            <td>{CHECK_LABELS[key] ?? key}</td>
                            <td>{CHECK_RESULT_LABELS[value] ?? value}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <p>まだ本人確認を開始していません。</p>
            )}

            <div className="actions">
              <button onClick={handleStartKyc} disabled={isBusy}>
                {statusData?.verification
                  ? "本人確認をやり直す"
                  : "本人確認を開始"}
              </button>
              <button
                className="secondary"
                onClick={() => sellerId && fetchStatus(sellerId, true)}
                disabled={isBusy}
              >
                最新状態を取得
              </button>
              <button className="secondary" onClick={handleReset}>
                別の販売者でやり直す
              </button>
            </div>
          </section>

          <section className="card">
            <h2>状態変化の履歴</h2>
            <EventTimeline events={statusData?.events ?? []} />
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              <Link href="/flow">全画面の可視化ビュー(デモ投影用)はこちら</Link>
            </p>
          </section>

          <section className="card">
            <h2>Webhook受信ログ(監査用)</h2>
            {webhookLogs.length === 0 ? (
              <p className="muted">
                まだWebhookを受信していません。ローカル検証では5秒ごとのポーリング
                (decision API)で状態を取得します。ngrok等で公開URLを用意すると
                Webhookも検証できます。
              </p>
            ) : (
              <table className="checks">
                <thead>
                  <tr>
                    <th>時刻(UTC)</th>
                    <th>status</th>
                    <th>署名</th>
                    <th>方式</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{log.createdAt}</td>
                      <td>{log.status}</td>
                      <td>{log.isSignatureValid ? "✅ 検証済" : "❌ 無効"}</td>
                      <td>{log.signatureMethod ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  );
}
