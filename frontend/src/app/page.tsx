import Link from "next/link";

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

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "72px 24px" }}>
      <h1>Trustca</h1>
      <p>鑑定済みカードを、根拠とともに取引するための基盤です。</p>
      {health.ok ? (
        <p>
          システム状態：API={health.data.status}、データベース={health.data.db}
        </p>
      ) : (
        <p>APIに接続できません：{health.error}</p>
      )}
      <p>
        <Link href="/payments/demo">JPYC決済MVPを開く →</Link>
      </p>
    </main>
  );
}
