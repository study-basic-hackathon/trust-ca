"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../../lib/api";

type Seller = {
  id: string;
  displayName: string;
  onboardingStatus: string;
};

export default function SellerRegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const seller = await api<Seller>("/api/v1/sellers", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      router.push(`/sellers/${seller.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登録に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "72px 24px" }}>
      <p>
        <Link href="/">← Trustcaトップへ戻る</Link>
      </p>
      <h1>販売者登録</h1>
      <p>表示名を入力して、販売者アカウントを作成してください。</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="displayName" style={{ display: "block", marginBottom: 8 }}>
          表示名
        </label>
        <input
          id="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={100}
          required
          style={{ width: "100%", padding: 8, fontSize: 16, marginBottom: 16 }}
        />
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        <button type="submit" disabled={submitting || !displayName.trim()}>
          {submitting ? "登録中…" : "登録する"}
        </button>
      </form>
    </main>
  );
}
