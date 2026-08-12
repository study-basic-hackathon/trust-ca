# Trust-CA backend

Hono製のAPIサーバー(TypeScript)。Cloud Runへのデプロイを想定。

## セットアップ

```bash
cp .env.example .env
pnpm install
```

## ローカル起動(単体)

```bash
pnpm dev
# → http://localhost:8080
```

`DATABASE_URL`が指すPostgreSQLに到達できる状態で起動する必要がある(`docker compose up db`等)。

## Docker Composeでの起動

リポジトリルートで:

```bash
docker compose up
```

frontend・backend・db(PostgreSQL)がまとめて起動する。backendは`http://localhost:8080`。

## 動作確認

```bash
curl http://localhost:8080/healthz
# → {"status":"ok","db":"ok"}
```

### PSA証明書照会MVP

`PSA_API_TOKEN`を取得後、`backend/.env`またはルートの`.env`へ設定し、`PSA_MVP_ENABLED=true`にする。無効時はPSAへリクエストしない。

```bash
curl -X POST http://localhost:8080/api/v1/cards/psa-verifications \
  -H 'Content-Type: application/json' \
  -d '{"certNumber":"12345678"}'
```

設定、判定方法、制約は[PSA API MVP設計書](../docs/design/psa-api-mvp.md)を参照。

## テスト

```bash
pnpm test
```

テストはDBとPSA APIをモックしているため、PostgresおよびPSA APIトークンなしで実行できる。

## 構成

| パス | 役割 |
|---|---|
| `src/db.ts` | `DATABASE_URL`から`pg.Pool`を生成。`pingDb()`で疎通確認 |
| `src/app.ts` | Honoアプリ本体(ルーティング+CORS)。`serve()`を呼ばないことでテスト時に`app.request()`を使える |
| `src/routes/health.ts` | `GET /healthz` |
| `src/routes/psa-verifications.ts` | `POST /api/v1/cards/psa-verifications` |
| `src/services/psa.ts` | PSA Public APIクライアント、正規化、キャッシュ、再試行 |
| `src/env.ts` | PSA APIを含む環境変数の読み取り |
| `src/index.ts` | `@hono/node-server`でHTTPサーバーを起動するエントリポイント |
