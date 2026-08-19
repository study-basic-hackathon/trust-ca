"use client";

import { FormEvent, useState } from "react";
import { uploadCardImage, type CardImageKind, type UploadedCardImage } from "../../../../lib/api/card-images";
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

type ViewState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; image: UploadedCardImage }
  | { kind: "error"; message: string };

export function SellerUploadForm({
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

    setState({ kind: "uploading" });
    try {
      const image = await uploadCardImage({
        backendUrl,
        token: token.trim(),
        cardId,
        imageKind,
        uploadContext: "listing",
        file,
      });
      setState({ kind: "success", image });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "アップロードに失敗しました。時間をおいて再度お試しください。",
      });
    }
  }

  return (
    <div className={styles.panel}>
      <h2>出品時の画像を登録する</h2>
      <p>
        PSA証明書番号を持たないカードは、四隅等の画像を出品時にアップロードしてください。到着後の内容整合性チェックの基準として保存されます。
      </p>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          出品者アカウントのセッショントークン
          <input
            type="text"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="wallet-authで発行されたトークン"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          撮影箇所
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
          disabled={state.kind === "uploading"}
        >
          {state.kind === "uploading" ? "アップロード中…" : "アップロードする"}
        </button>
      </form>

      {state.kind === "error" && (
        <p className={`${styles.message} ${styles.errorMessage}`} role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "success" && (
        <p className={`${styles.message} ${styles.successMessage}`}>
          {IMAGE_KIND_OPTIONS.find((option) => option.value === state.image.imageKind)?.label}
          を保存しました(image ID: {state.image.id})。
        </p>
      )}
    </div>
  );
}
