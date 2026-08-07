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

## テスト

```bash
pnpm test
```

`tests/health.test.ts`はDBをモックしているため、Postgresなしで実行できる。

## 構成

| パス | 役割 |
|---|---|
| `src/db.ts` | `DATABASE_URL`から`pg.Pool`を生成。`pingDb()`で疎通確認 |
| `src/app.ts` | Honoアプリ本体(ルーティング+CORS)。`serve()`を呼ばないことでテスト時に`app.request()`を使える |
| `src/routes/health.ts` | `GET /healthz` |
| `src/index.ts` | `@hono/node-server`でHTTPサーバーを起動するエントリポイント |
