import type { Metadata } from "next";
import Link from "next/link";
import { BuyerAnalysisView } from "./buyer-analysis-view";
import { SellerUploadForm } from "./seller-upload-form";

export const metadata: Metadata = {
  title: "カード画像コンテンツチェックMVP｜Trustca",
  description: "Vision APIによるカード画像の内容整合性チェックMVP",
};

export default async function CardImagesPage({
  params,
}: {
  params: Promise<{ cardId: string }>;
}) {
  const { cardId } = await params;
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <p><Link href="/">Trustcaトップへ戻る</Link></p>
      <h1>カード画像コンテンツチェック(MVP)</h1>
      <p>
        対象カード ID: <code>{cardId}</code>
      </p>
      <p style={{ fontSize: "0.85rem", color: "#777" }}>
        PSA証明書番号を持たないカードの出品時画像アップロードと、到着後の内容整合性チェックを行います。物理的な同一個体の照合は行いません。
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1.5rem" }}>
        <SellerUploadForm cardId={cardId} backendUrl={backendUrl} />
        <BuyerAnalysisView cardId={cardId} backendUrl={backendUrl} />
      </div>
    </main>
  );
}
