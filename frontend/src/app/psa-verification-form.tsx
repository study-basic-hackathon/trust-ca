"use client";

import { FormEvent, useState } from "react";
import styles from "./page.module.css";

type PsaCard = {
  certNumber: string;
  year: string | null;
  brand: string | null;
  category: string | null;
  cardNumber: string | null;
  subject: string | null;
  variety: string | null;
  gradeDescription: string | null;
  cardGrade: string | null;
  totalPopulation: number | null;
  populationHigher: number | null;
};

type Verification = {
  certNumber: string;
  status: "verified" | "not_found" | "invalid_request" | "in_review";
  checkedAt: string;
  expiresAt: string;
  cacheHit: boolean;
  card?: PsaCard;
};

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: Verification }
  | { kind: "error"; message: string };

const statusCopy = {
  verified: {
    label: "PSA登録情報確認済み",
    detail: "入力された証明書番号とPSAのカード登録情報が一致しました。",
  },
  not_found: {
    label: "登録情報が見つかりません",
    detail: "番号を再確認し、解決しない場合は目視確認へ進めてください。",
  },
  invalid_request: {
    label: "番号を確認してください",
    detail: "PSAが有効な証明書番号として受け付けませんでした。",
  },
  in_review: {
    label: "自動確認できません",
    detail: "結果を承認扱いにせず、運営者による目視確認へ回してください。",
  },
} as const;

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tokyo",
      }).format(date);
}

export function PsaVerificationForm({ backendUrl }: { backendUrl: string }) {
  const [certNumber, setCertNumber] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = certNumber.trim();
    if (!/^\d{1,32}$/.test(normalized)) {
      setState({
        kind: "error",
        message: "証明書番号は1〜32桁の半角数字で入力してください。",
      });
      return;
    }

    setState({ kind: "loading" });
    try {
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/api/v1/cards/psa-verifications`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ certNumber: normalized }),
        },
      );
      const payload = (await response.json()) as {
        data?: Verification;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(
          payload.error?.message ?? "PSAの登録情報を確認できませんでした。",
        );
      }
      setState({ kind: "success", result: payload.data });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "通信に失敗しました。時間をおいて再度お試しください。",
      });
    }
  }

  const result = state.kind === "success" ? state.result : null;
  const copy = result ? statusCopy[result.status] : null;

  return (
    <div className={styles.lookupPanel}>
      <div className={styles.labelTop} aria-hidden="true">
        <span />
        <span />
      </div>

      <div className={styles.panelHeading}>
        <div>
          <p className={styles.panelKicker}>PSA証明書照会</p>
          <h2>登録情報を確認</h2>
        </div>
        <span className={styles.specimen}>照会用</span>
      </div>

      <form className={styles.form} onSubmit={submit} noValidate>
        <label htmlFor="cert-number">PSA証明書番号</label>
        <div className={styles.inputRow}>
          <span className={styles.inputPrefix} aria-hidden="true">
            CERT
          </span>
          <input
            id="cert-number"
            name="certNumber"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={32}
            pattern="[0-9]{1,32}"
            placeholder="例：12345678"
            value={certNumber}
            onChange={(event) => setCertNumber(event.target.value)}
            aria-describedby="cert-number-help"
          />
          <button type="submit" disabled={state.kind === "loading"}>
            {state.kind === "loading" ? "照会中…" : "照会する"}
          </button>
        </div>
        <p id="cert-number-help" className={styles.formHelp}>
          PSAケース上部のラベルに記載された数字を入力してください。
        </p>
      </form>

      <div className={styles.resultArea} aria-live="polite" aria-busy={state.kind === "loading"}>
        {state.kind === "idle" && (
          <div className={styles.idleState}>
            <span className={styles.idleMark}>01</span>
            <div>
              <p className={styles.idleTitle}>照会待ち</p>
              <p>証明書番号を入力すると、PSAの登録情報をここに表示します。</p>
            </div>
          </div>
        )}

        {state.kind === "loading" && (
          <div className={styles.loadingState}>
            <span className={styles.loadingBar} />
            <p>PSA登録情報へ照会しています。</p>
          </div>
        )}

        {state.kind === "error" && (
          <div className={styles.errorState} role="alert">
            <p className={styles.resultStatus}>照会できませんでした</p>
            <p>{state.message}</p>
          </div>
        )}

        {result && copy && (
          <div className={styles.resultCard} data-status={result.status}>
            <div className={styles.resultHeader}>
              <div>
                <p className={styles.resultCode}>CERT {result.certNumber}</p>
                <p className={styles.resultStatus}>{copy.label}</p>
              </div>
              <span className={styles.statusSeal} aria-hidden="true">
                {result.status === "verified" ? "確認" : "保留"}
              </span>
            </div>
            <p className={styles.resultDetail}>{copy.detail}</p>

            {result.card && (
              <dl className={styles.cardData}>
                <div className={styles.subjectRow}>
                  <dt>登録カード</dt>
                  <dd>{display(result.card.subject)}</dd>
                </div>
                <div>
                  <dt>年</dt>
                  <dd>{display(result.card.year)}</dd>
                </div>
                <div>
                  <dt>ブランド</dt>
                  <dd>{display(result.card.brand)}</dd>
                </div>
                <div>
                  <dt>カード番号</dt>
                  <dd>{display(result.card.cardNumber)}</dd>
                </div>
                <div>
                  <dt>バリエーション</dt>
                  <dd>{display(result.card.variety)}</dd>
                </div>
                <div>
                  <dt>グレード</dt>
                  <dd className={styles.gradeValue}>
                    {display(result.card.cardGrade)} {display(result.card.gradeDescription)}
                  </dd>
                </div>
                <div>
                  <dt>同一グレード登録数</dt>
                  <dd>{display(result.card.totalPopulation)}</dd>
                </div>
                <div>
                  <dt>上位グレード登録数</dt>
                  <dd>{display(result.card.populationHigher)}</dd>
                </div>
              </dl>
            )}

            <p className={styles.checkedAt}>
              照会日時：{formatCheckedAt(result.checkedAt)}
              {result.cacheHit ? "（キャッシュ）" : ""}
            </p>
          </div>
        )}
      </div>

      <p className={styles.disclaimer}>
        この照会はPSAデータベース上の登録情報との一致を確認するもので、撮影された現物の真正性を保証するものではありません。
      </p>
    </div>
  );
}
