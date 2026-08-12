# Trust-CA frontend

Next.js(App Router)。Firebase App HostingでのSSRを前提にしており、`output: "export"`は使わない。

サーバー側の役割はSSR/画面描画に付随する処理までで、業務ロジックは持たない。業務ロジックはすべて[backend/](../backend/)(Hono API)に集約する方針。詳細は[docs/design/system-architecture.md](../docs/design/system-architecture.md)を参照。

## セットアップ

```bash
cp .env.example .env
pnpm install
```

## ローカル起動(単体)

```bash
pnpm dev
# → http://localhost:3000
```

`BACKEND_URL`と`NEXT_PUBLIC_BACKEND_URL`が指すbackendに到達できる状態で起動する必要がある(`docker compose up backend`等)。前者はSSR用、後者はブラウザからの直接fetch用であり、秘密情報を`NEXT_PUBLIC_*`へ指定してはならない。

## Docker Composeでの起動

リポジトリルートで:

```bash
docker compose up
```

frontend・backend・db(PostgreSQL)がまとめて起動する。frontendは`http://localhost:3000`。トップページはbackendの疎通状況を表示し、PSA証明書番号の照会フォームからbackendへ直接リクエストする。
