"use client";

import { useCallback, useState } from "react";
import { api, ApiError } from "../../../lib/api";

type AdminVerification = {
  sessionId: string;
  sellerId: string;
  status: string;
  checks: Record<string, string> | null;
  requestedAt: string;
};

export default function AdminVerificationsPage() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<AdminVerification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const data = await api<AdminVerification[]>(
        "/api/v1/admin/verifications",
        {},
        token,
      );
      setItems(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "一覧を取得できませんでした。");
    }
  }, [token]);

  async function decide(sessionId: string, decision: "approved" | "declined") {
    const reason = window.prompt(
      decision === "approved" ? "承認理由を入力してください" : "却下理由を入力してください",
    );
    if (!reason) return;

    setBusySessionId(sessionId);
    setError(null);
    try {
      await api(
        `/api/v1/admin/verifications/${sessionId}/decision`,
        { method: "POST", body: JSON.stringify({ decision, reason }) },
        token,
      );
      await loadList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "確定に失敗しました。");
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "72px 24px" }}>
      <h1>運営者向け：審査中の本人確認</h1>
      <p>
        <label htmlFor="admin-token">運営者トークン（ADMIN_API_TOKEN）</label>
        <br />
        <input
          id="admin-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          style={{ width: "100%", padding: 8, fontSize: 16, margin: "8px 0" }}
        />
        <button onClick={loadList} disabled={!token}>
          一覧を取得
        </button>
      </p>

      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {items ? (
        items.length === 0 ? (
          <p>審査中の本人確認はありません。</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>販売者ID</th>
                <th style={{ textAlign: "left" }}>依頼日時</th>
                <th style={{ textAlign: "left" }}>チェック結果</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.sessionId}>
                  <td>{item.sellerId}</td>
                  <td>{new Date(item.requestedAt).toLocaleString("ja-JP")}</td>
                  <td>{item.checks ? JSON.stringify(item.checks) : "-"}</td>
                  <td>
                    <button
                      onClick={() => decide(item.sessionId, "approved")}
                      disabled={busySessionId === item.sessionId}
                    >
                      承認
                    </button>{" "}
                    <button
                      onClick={() => decide(item.sessionId, "declined")}
                      disabled={busySessionId === item.sessionId}
                    >
                      却下
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </main>
  );
}
