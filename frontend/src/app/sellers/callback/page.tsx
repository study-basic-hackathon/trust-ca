import { Suspense } from "react";
import { CallbackRedirect } from "./callback-redirect";

export default function SellerCallbackPage() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "72px 24px" }}>
      <h1>本人確認</h1>
      <Suspense fallback={<p>読み込み中…</p>}>
        <CallbackRedirect />
      </Suspense>
    </main>
  );
}
