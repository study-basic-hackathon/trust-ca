import type { Metadata } from "next";
import Link from "next/link";
import { AdminAnalysisList } from "./admin-analysis-list";

export const metadata: Metadata = {
  title: "要確認一覧(運営者向け)｜Trustca",
  description: "Vision APIによるカード画像コンテンツチェックで要確認となったケースの一覧",
};

export default function AdminCardImageAnalysesPage() {
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <p><Link href="/">Trustcaトップへ戻る</Link></p>
      <h1>カード画像コンテンツチェック: 要確認一覧</h1>
      <p style={{ fontSize: "0.85rem", color: "#777" }}>
        自動判定は補助シグナルであり、ここに表示されるケースは目視確認が必要です。
      </p>
      <AdminAnalysisList backendUrl={backendUrl} />
    </main>
  );
}
