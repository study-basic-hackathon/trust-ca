"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "../../../lib/api";

type Seller = {
  id: string;
  displayName: string;
  onboardingStatus: string;
};

type VerificationStatus =
  | "not_started"
  | "in_progress"
  | "in_review"
  | "approved"
  | "declined"
  | "abandoned"
  | "expired";

type VerificationView = {
  verification: {
    sessionId: string;
    status: VerificationStatus;
    sessionUrl: string | null;
  } | null;
  isSellingAllowed: boolean;
};

const STATUS_LABEL: Record<VerificationStatus, string> = {
  not_started: "未開始",
  in_progress: "本人確認中",
  in_review: "審査中(運営者確認待ち)",
  approved: "承認済み",
  declined: "否認",
  abandoned: "中断",
  expired: "期限切れ",
};

// 本人確認中は結果を待っている最中なので短い間隔、審査中は運営者判断待ちで
// 即時性が求められないため長い間隔にする。確定状態(承認/否認等)ではpollingを止める。
const RESUMABLE_STATUSES = new Set<VerificationStatus>(["not_started", "in_progress"]);
const FAST_POLL_INTERVAL_MS = 5_000;
const SLOW_POLL_INTERVAL_MS = 30_000;

function pollIntervalFor(status: VerificationStatus | undefined): number | false {
  if (!status) return false;
  if (RESUMABLE_STATUSES.has(status)) return FAST_POLL_INTERVAL_MS;
  if (status === "in_review") return SLOW_POLL_INTERVAL_MS;
  return false;
}

export default function SellerStatusPage() {
  const params = useParams<{ sellerId: string }>();
  const sellerId = params.sellerId;

  const sellerQuery = useQuery({
    queryKey: ["seller", sellerId],
    queryFn: () => api<Seller>(`/api/v1/sellers/${sellerId}`),
  });

  const verificationQuery = useQuery({
    queryKey: ["seller-verification", sellerId],
    queryFn: () =>
      api<VerificationView>(`/api/v1/sellers/${sellerId}/verification?refresh=1`),
    refetchInterval: (query) => pollIntervalFor(query.state.data?.verification?.status),
  });

  const startVerification = useMutation({
    mutationFn: () =>
      api<{ sessionUrl: string }>(`/api/v1/sellers/${sellerId}/kyc-sessions`, {
        method: "POST",
      }),
    onSuccess: (session) => {
      window.location.href = session.sessionUrl;
    },
  });

  const view = verificationQuery.data;
  const error =
    (sellerQuery.error instanceof ApiError && sellerQuery.error.message) ||
    (verificationQuery.error instanceof ApiError && verificationQuery.error.message) ||
    (startVerification.error instanceof ApiError && startVerification.error.message) ||
    null;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "72px 24px" }}>
      <p>
        <Link href="/">← Trustcaトップへ戻る</Link>
      </p>
      <h1>{sellerQuery.data ? sellerQuery.data.displayName : "販売者"}</h1>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {view ? (
        <>
          <p>
            本人確認の状態：
            <strong>
              {view.verification ? STATUS_LABEL[view.verification.status] : "未開始"}
            </strong>
          </p>
          <p>出品可否：{view.isSellingAllowed ? "出品可能" : "出品不可"}</p>

          {!view.verification || RESUMABLE_STATUSES.has(view.verification.status) ? (
            <button
              onClick={() => startVerification.mutate()}
              disabled={startVerification.isPending}
            >
              {startVerification.isPending ? "開始しています…" : "本人確認を開始する"}
            </button>
          ) : null}

          {view.verification?.status === "declined" ? (
            <button
              onClick={() => startVerification.mutate()}
              disabled={startVerification.isPending}
            >
              {startVerification.isPending ? "開始しています…" : "本人確認をやり直す"}
            </button>
          ) : null}
        </>
      ) : (
        <p>読み込み中…</p>
      )}
    </main>
  );
}
