"use client";

import { CSSProperties, FormEvent, useState } from "react";

type AdminAnalysisRow = {
  id: string;
  cardId: string;
  status: "pending" | "processing" | "completed" | "in_review" | "failed";
  score: number | null;
  normalizedResult: {
    ocrText: string;
    matchedName: boolean;
    matchedCardNumber: boolean | null;
    cardLikeLabelDetected: boolean;
    failureReason: string | null;
  } | null;
  createdAt: string;
  card: { name: string; series: string | null; cardNumber: string | null };
  image: { storageBucket: string; storageObject: string };
};

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; rows: AdminAnalysisRow[] }
  | { kind: "error"; message: string };

export function AdminAnalysisList({ backendUrl }: { backendUrl: string }) {
  const [token, setToken] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) {
      setState({ kind: "error", message: "内部トークンを入力してください。" });
      return;
    }

    setState({ kind: "loading" });
    try {
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/api/v1/admin/card-image-analyses?status=in_review`,
        { headers: { authorization: `Bearer ${token.trim()}` } },
      );
      const payload = (await response.json()) as
        | { data: AdminAnalysisRow[] }
        | { error: { message?: string } };
      if (!response.ok || !("data" in payload)) {
        throw new Error(
          "error" in payload && payload.error.message
            ? payload.error.message
            : "一覧の取得に失敗しました。",
        );
      }
      setState({ kind: "success", rows: payload.data });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error ? error.message : "通信に失敗しました。",
      });
    }
  }

  return (
    <div>
      <form onSubmit={load} style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <input
          type="text"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="VISION_ADMIN_TOKEN"
          autoComplete="off"
          style={{ flex: 1, padding: "0.5rem" }}
        />
        <button type="submit" disabled={state.kind === "loading"}>
          {state.kind === "loading" ? "読み込み中…" : "要確認一覧を取得"}
        </button>
      </form>

      {state.kind === "error" && (
        <p role="alert" style={{ color: "#b3261e" }}>
          {state.message}
        </p>
      )}

      {state.kind === "success" && state.rows.length === 0 && (
        <p>要確認のケースはありません。</p>
      )}

      {state.kind === "success" && state.rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cellStyle}>解析ID</th>
              <th style={cellStyle}>カード</th>
              <th style={cellStyle}>状態</th>
              <th style={cellStyle}>スコア</th>
              <th style={cellStyle}>画像object</th>
              <th style={cellStyle}>作成日時</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.id}>
                <td style={cellStyle}>{row.id}</td>
                <td style={cellStyle}>
                  {row.card.name}
                  {row.card.cardNumber ? ` (${row.card.cardNumber})` : ""}
                </td>
                <td style={cellStyle}>{row.status}</td>
                <td style={cellStyle}>{row.score ?? "—"}</td>
                <td style={cellStyle}>{row.image.storageObject}</td>
                <td style={cellStyle}>{row.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cellStyle: CSSProperties = {
  border: "1px solid #ddd",
  padding: "0.4rem 0.6rem",
  fontSize: "0.85rem",
  textAlign: "left",
};
