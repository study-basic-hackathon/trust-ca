import { PsaVerificationForm } from "./psa-verification-form";
import styles from "./page.module.css";

type BackendHealth = {
  status: string;
  db: string;
};

async function getBackendHealth(): Promise<
  { ok: true; data: BackendHealth } | { ok: false; error: string }
> {
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8080";
  try {
    const res = await fetch(`${backendUrl}/healthz`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `backend responded with ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as BackendHealth };
  } catch {
    return { ok: false, error: "backend unreachable" };
  }
}

export default async function Home() {
  const health = await getBackendHealth();
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8080";

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="#top" aria-label="Trustca トップ">
          <span className={styles.brandMark} aria-hidden="true">T</span>
          <span>Trustca</span>
        </a>
        <div className={styles.systemStatus}>
          <span
            className={health.ok ? styles.statusOnline : styles.statusOffline}
            aria-hidden="true"
          />
          <span>{health.ok ? "照会基盤 稼働中" : "照会基盤 接続待ち"}</span>
        </div>
      </header>

      <main id="top" className={styles.main}>
        <section className={styles.introduction} aria-labelledby="page-title">
          <p className={styles.eyebrow}>出品前チェック / 01</p>
          <h1 id="page-title">
            鑑定情報を、
            <br />
            出品前に照合。
          </h1>
          <p className={styles.lead}>
            PSA証明書番号からカード名とグレードを取得し、Trustcaでの出品審査に使える形で確認します。
          </p>

          <ol className={styles.steps} aria-label="照会の流れ">
            <li>
              <span>01</span>
              証明書番号を入力
            </li>
            <li>
              <span>02</span>
              PSA登録情報と照合
            </li>
            <li>
              <span>03</span>
              出品情報へ反映
            </li>
          </ol>

          <aside className={styles.scopeNote}>
            <p>確認できること</p>
            <ul>
              <li>PSA上のカード登録情報</li>
              <li>グレードと個体数情報</li>
              <li>照会時点と確認状態</li>
            </ul>
          </aside>
        </section>

        <section className={styles.workspace} aria-label="PSA証明書照会フォーム">
          <PsaVerificationForm backendUrl={backendUrl} />
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Trustca / 高額カード取引のための事前審査</span>
        <span>PSA照会 MVP</span>
      </footer>
    </div>
  );
}
