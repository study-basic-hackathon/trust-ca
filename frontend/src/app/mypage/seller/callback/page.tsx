"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Didit Hosted Flow完了後の着地ページ。
 * ブラウザのリダイレクトは検証結果として信用せず、
 * マイページへ戻って(サーバー間通信による)状態取得に任せる。
 */
export default function SellerKycCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/mypage/seller");
    }, 800);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="text-lg font-medium">確認結果を取得しています…</p>
      <p className="mt-2 text-sm text-muted-foreground">
        自動的にマイページへ戻ります。
      </p>
    </main>
  );
}
