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

初回起動前にmigrationを適用する。

```bash
pnpm db:migrate
pnpm db:migrate:status
```

## Docker Composeでの起動

リポジトリルートで:

```bash
docker compose up
```

frontend・backend・db(PostgreSQL)がまとめて起動する。`migrate` serviceがDB初期化を完了した後にbackendが起動する。backendは`http://localhost:8080`。

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

実PostgreSQLでmigrationと主要制約を確認する場合:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trustca pnpm test:db
```

`test:db`はランダム名の一時schemaだけを作成し、終了時に削除する。指定したDBの`public` schemaは変更しない。

## 構成

| パス | 役割 |
|---|---|
| `src/db.ts` | `DATABASE_URL`から`pg.Pool`を生成。`pingDb()`で疎通確認 |
| `src/db/migrations/` | 番号付きPostgreSQL migration。適用済みファイルは編集しない |
| `scripts/migrate.mjs` | transaction、advisory lock、checksum付きmigration CLI |
| `scripts/test-migrations.mjs` | 一時schemaを使うmigration統合テスト |
| `src/app.ts` | Honoアプリ本体(ルーティング+CORS)。`serve()`を呼ばないことでテスト時に`app.request()`を使える |
| `src/routes/health.ts` | `GET /healthz` |
| `src/index.ts` | `@hono/node-server`でHTTPサーバーを起動するエントリポイント |

スキーマ全体と運用方針は[データベーススキーマ設計書](../docs/design/database-schema.md)を参照。
