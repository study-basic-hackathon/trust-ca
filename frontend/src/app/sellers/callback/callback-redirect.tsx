"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { api, ApiError } from "../../../lib/api";

/**
 * Diditからのブラウザ遷移そのものは信用しない。ここでは
 * `GET /api/v1/sellers/{sellerId}/verification?refresh=1` を叩いて
 * サーバー間通信で確認済みの最新状態を取得するトリガーとしてのみ使い、
 * 取得結果に関わらず状態表示ページへ遷移する。
 */
export function CallbackRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sellerId = searchParams.get("sellerId");

  useEffect(() => {
    if (!sellerId) return;
    api(`/api/v1/sellers/${sellerId}/verification?refresh=1`)
      .catch((err) => {
        console.error(err instanceof ApiError ? err.message : err);
      })
      .finally(() => {
        router.replace(`/sellers/${sellerId}`);
      });
  }, [sellerId, router]);

  if (!sellerId) {
    return <p style={{ color: "crimson" }}>sellerIdが指定されていません。</p>;
  }
  return <p>本人確認の結果を確認しています…</p>;
}
