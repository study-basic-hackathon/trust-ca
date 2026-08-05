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
import { STATUS_LABELS } from "@/components/flowTypes";

type StatusData = {
  seller: { id: string; displayName: string };
  verification: {
    sessionId: string;
    status: string;
    source: string;
    updatedAt: string;
  } | null;
  isSellingAllowed: boolean;
  flowSteps: FlowStepView[];
  events: VerificationEventView[];
};

const POLL_INTERVAL_MS = 5000;
const SELLER_ID_STORAGE_KEY = "trust-ca:sellerId";

/**
 * Fullscreen visualization of the verification flow — same panels as the
 * top page, meant for a second window or demo projection.
 */
export default function FlowPage() {
  const [sellerId] = useLocalStorageValue(SELLER_ID_STORAGE_KEY);
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (id: string, refresh: boolean) => {
    try {
      const res = await fetch(
        `/api/kyc/status?sellerId=${encodeURIComponent(id)}${refresh ? "&refresh=1" : ""}`,
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setStatusData(json.data as StatusData);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "取得に失敗しました",
      );
    }
  }, []);

  useEffect(() => {
    if (!sellerId) return;
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

  return (
    <main className="container">
      <p>
        <Link href="/">← トップへ戻る</Link>
      </p>
      <h1>認証フロー可視化</h1>
      <p className="subtitle">
        eKYCの各段階と、状態変化の履歴をリアルタイムに表示します
      </p>

      {errorMessage && <div className="error-box">{errorMessage}</div>}

      {!sellerId ? (
        <div className="card">
          <p>
            販売者が未登録です。<Link href="/">トップページ</Link>
            で登録してください。
          </p>
        </div>
      ) : !statusData ? (
        <div className="card">
          <p>読み込み中...</p>
        </div>
      ) : (
        <>
          <section className="card">
            <h2>
              {statusData.seller.displayName} さんの進行状況
              {statusData.verification && (
                <span
                  className={`status status-${statusData.verification.status}`}
                >
                  {STATUS_LABELS[statusData.verification.status] ??
                    statusData.verification.status}
                </span>
              )}
            </h2>

            <FlowStepper steps={statusData.flowSteps} />

            {verificationStatus &&
              ["not_started", "in_progress"].includes(verificationStatus) && (
                <p className="muted">
                  5秒ごとにDidit decision APIをポーリングして自動更新中です。
                </p>
              )}
          </section>

          <section className="card">
            <h2>状態変化の履歴</h2>
            <EventTimeline events={statusData.events} />
          </section>
        </>
      )}
    </main>
  );
}
