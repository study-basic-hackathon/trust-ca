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
    <main>
      <h1>Trustca</h1>
      <p>frontend/ ⇄ backend/ の疎通確認ページ</p>
      {health.ok ? (
        <p>
          backend: status={health.data.status}, db={health.data.db}
        </p>
      ) : (
        <p>backend未到達: {health.error}</p>
      )}
    </main>
  );
}
