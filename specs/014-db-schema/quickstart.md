# Quickstart: PostgreSQL migration

## Docker Compose

リポジトリルートで次を実行する。

```bash
docker compose up --build
```

`migrate` serviceがPostgreSQLのhealthcheck完了後に`pnpm db:migrate`を実行し、成功した場合だけbackendが起動する。

## Backend単体

```bash
cd backend
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:migrate:status
```

`DATABASE_URL`がローカルPostgreSQLまたはCloud SQLへ接続できる必要がある。
Trustca専用databaseでは`DATABASE_SCHEMA=public`を使用する。databaseを共有する場合は専用schema名を指定する。

## Migration統合テスト

テスト用PostgreSQLへ接続するURLを指定する。テストはランダム名の一時schemaだけを作成し、終了時にそのschemaを削除する。

```bash
cd backend
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trustca pnpm test:db
```

確認内容:

- 初回適用件数が1、2回目が0
- 全tableの存在
- address/hash形式のCHECK
- wallet、PSA Cert、active listing、tx hashの一意制約
- migration checksum

## 新しいmigrationの追加

1. `backend/src/db/migrations/`へ`0002_short_description.sql`の形式で追加する。
2. 既に適用したSQLファイルは編集しない。修正は新しいversionで行う。
3. `pnpm test:db`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`を実行する。
4. 本番ではCloud Run serviceへtrafficを切り替える前に、migration用DB roleを使うCloud Run Job等で`pnpm db:migrate`を実行する。
