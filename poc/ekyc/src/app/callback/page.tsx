"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Didit's hosted flow redirects here when the user finishes. The redirect
 * itself is NOT trusted as a verification result — it only triggers a
 * server-side decision refresh; the DB is updated from Didit's API.
 */
function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("検証結果を確認しています...");

  useEffect(() => {
    const sellerId =
      searchParams.get("sellerId") ??
      localStorage.getItem("trust-ca:sellerId");

    if (!sellerId) {
      router.replace("/");
      return;
    }

    const refresh = async () => {
      try {
        await fetch(
          `/api/kyc/status?sellerId=${encodeURIComponent(sellerId)}&refresh=1`,
        );
      } catch {
        setMessage("結果の取得に失敗しました。トップページで再取得してください。");
      }
      router.replace("/");
    };

    refresh();
  }, [router, searchParams]);

  return (
    <main className="container">
      <div className="card">
        <p>{message}</p>
      </div>
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="container">
          <div className="card">
            <p>読み込み中...</p>
          </div>
        </main>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
