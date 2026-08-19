"use client";

import { FormEvent, useState } from "react";
import {
  runCardImageAnalysis,
  uploadCardImage,
  type CardImageAnalysisResult,
  type CardImageKind,
} from "../../../../lib/api/card-images";
import styles from "./images.module.css";

const IMAGE_KIND_OPTIONS: { value: CardImageKind; label: string }[] = [
  { value: "corner_top_left", label: "左上の角" },
  { value: "corner_top_right", label: "右上の角" },
  { value: "corner_bottom_left", label: "左下の角" },
  { value: "corner_bottom_right", label: "右下の角" },
  { value: "front", label: "表面全体" },
  { value: "back", label: "裏面全体" },
  { value: "label", label: "PSAラベル等" },
];

const STATUS_COPY: Record<
  CardImageAnalysisResult["status"],
  { label: string; detail: string }
> = {
  completed: {
    label: "内容整合",
    detail: "OCR結果が出品時の申告内容と整合しました。",
  },
  in_review: {
    label: "要確認",
    detail: "内容が申告と整合しない、またはカード撮影として判断できませんでした。運営者による確認へ進めてください。",
  },
  failed: {
    label: "要確認(解析エラー)",
    detail: "Vision APIの解析に失敗しました。運営者による確認へ進めてください。",
  },
};

type ViewState =
  | { kind: "idle" }
  | { kind: "processing" }
  | { kind: "success"; result: CardImageAnalysisResult }
  | { kind: "error"; message: string };

export function BuyerAnalysisView({
  cardId,
  backendUrl,
}: {
  cardId: string;
  backendUrl: string;
}) {
  const [token, setToken] = useState("");
  const [imageKind, setImageKind] = useState<CardImageKind>("corner_top_left");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim() || !file) {
      setState({
        kind: "error",
        message: "セッショントークンと画像ファイルを指定してください。",
      });
      return;
    }

    setState({ kind: "processing" });
    try {
      const image = await uploadCardImage({
        backendUrl,
        token: token.trim(),
        cardId,
        imageKind,
        uploadContext: "arrival",
        file,
      });
      const result = await runCardImageAnalysis({
        backendUrl,
        token: token.trim(),
        cardId,
        imageId: image.id,
      });
      setState({ kind: "success", result });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "処理に失敗しました。時間をおいて再度お試しください。",
      });
    }
  }

  const result = state.kind === "success" ? state.result : null;
  const copy = result ? STATUS_COPY[result.status] : null;

  return (
    <div className={styles.panel}>
      <h2>到着後の画像で内容整合性をチェックする</h2>
      <p>
        商品到着後、出品時と同一箇所を再撮影してアップロードすると、Vision APIのOCR・ラベル・領域検出結果と出品時申告内容を突合します。
      </p>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          購入者アカウントのセッショントークン
          <input
            type="text"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="wallet-authで発行されたトークン"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          撮影箇所(出品時と同一箇所)
          <select
            value={imageKind}
            onChange={(event) => setImageKind(event.target.value as CardImageKind)}
          >
            {IMAGE_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          画像ファイル(JPEG/PNG/WebP)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="submit"
          className={styles.submit}
          disabled={state.kind === "processing"}
        >
          {state.kind === "processing" ? "解析中…" : "アップロードしてチェックする"}
        </button>
      </form>

      {state.kind === "error" && (
        <p className={`${styles.message} ${styles.errorMessage}`} role="alert">
          {state.message}
        </p>
      )}

      {result && copy && (
        <div className={styles.resultCard} data-status={result.status}>
          <p className={styles.resultStatus}>{copy.label}</p>
          <p className={styles.resultDetail}>{copy.detail}</p>
          {result.normalizedResult && (
            <p className={styles.ocrText}>{result.normalizedResult.ocrText || "(OCRテキストなし)"}</p>
          )}
        </div>
      )}

      <p className={styles.disclaimer}>
        このチェックはOCR等による内容の一次スクリーニングであり、現物の真正性・個体の同一性を保証するものではありません。精巧な偽造品(印字内容が本物と同一のもの)は検出できません。
      </p>
    </div>
  );
}
