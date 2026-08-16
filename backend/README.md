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

## 非同期オンチェーン記録MVP

監査イベントとoutboxを同一transactionで登録し、別processのworkerがpayload hashをEVM contractへ記録する。通常のbackend開発では`ONCHAIN_MVP_ENABLED=false`のままにする。

Docker Composeでlocal chainを含めて起動する場合:

```bash
cp ../.env.example ../.env
# ../.env のONCHAIN_MVP_ENABLEDをtrueへ変更
cd ..
docker compose --profile blockchain up --build
```

内部API:

| Method / Path | 用途 | 成功status |
|---|---|---|
| `POST /api/v1/internal/onchain-anchors` | eventとoutboxを冪等登録 | 新規`202`、同一再送`200` |
| `GET /api/v1/internal/onchain-anchors/:auditEventId` | 配送・receipt状態を取得 | `200` |

両endpointは`Authorization: Bearer <ONCHAIN_INTERNAL_TOKEN>`が必須。本番ではBearer tokenではなくCloud Run IAM / OIDCへ置き換える。

実PostgreSQLのoutbox統合テスト:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trustca \
pnpm test:onchain:db
```

Docker Compose E2E:

```bash
BACKEND_URL=http://localhost:8080 \
ONCHAIN_RPC_URL=http://localhost:8545 \
ONCHAIN_INTERNAL_TOKEN=local-onchain-internal-token-change-me \
pnpm test:onchain:e2e
```

設計、状態遷移、failure recovery、本番移行は[非同期オンチェーン記録設計書](../docs/design/async-onchain-write.md)を参照する。

## JPYC決済・ウォレット認証MVP

backendがEIP-4361 challengeと短時間sessionを発行し、注文ごとのJPYC transferを非同期workerで検証する。browserが申告したtx hashだけでは支払確定にせず、receipt、calldata、`Transfer` eventを照合する。

主なAPI:

| Method / Path | 用途 |
|---|---|
| `POST /api/v1/wallet-auth/challenges` | SIWE message発行 |
| `POST /api/v1/wallet-auth/verifications` | 署名検証・session発行 |
| `POST /api/v1/payments` | 注文からpayment intent作成 |
| `POST /api/v1/payments/:id/submissions` | tx hash登録 |
| `GET /api/v1/payments/:id` | 検証状態取得 |

Docker Compose E2E:

```bash
docker compose exec \
  -e BACKEND_URL=http://localhost:8080 \
  -e PAYMENT_RPC_URL=http://chain:8545 \
  backend pnpm test:payment:e2e
```

設計とmainnet移行条件は[JPYC決済・ウォレット認証MVP設計書](../docs/design/jpyc-payment.md)を参照する。

## 構成

| パス | 役割 |
|---|---|
| `src/db.ts` | `DATABASE_URL`から`pg.Pool`を生成。`pingDb()`で疎通確認 |
| `src/db/migrations/` | 番号付きPostgreSQL migration。適用済みファイルは編集しない |
| `scripts/migrate.mjs` | transaction、advisory lock、checksum付きmigration CLI |
| `scripts/test-migrations.mjs` | 一時schemaを使うmigration統合テスト |
| `scripts/test-onchain-outbox.ts` | 一時schemaでoutboxのtransaction・冪等性・同時claimを検証 |
| `scripts/test-onchain-e2e.mjs` | API→DB→worker→contract→receiptを検証 |
| `scripts/test-payment-e2e.mjs` | SIWE→JPYC transfer→payment worker→DB状態遷移を検証 |
| `src/app.ts` | Honoアプリ本体(ルーティング+CORS)。`serve()`を呼ばないことでテスト時に`app.request()`を使える |
| `src/routes/health.ts` | `GET /healthz` |
| `src/routes/onchain-anchors.ts` | 監査event登録・状態取得用の内部API |
| `src/db/onchain-outbox.ts` | transactional outbox repository |
| `src/blockchain/audit-anchor.ts` | viem client、chain/contract/operator検証 |
| `src/blockchain/jpyc-payment.ts` | JPYC metadata、transaction input、receipt event検証 |
| `src/workers/onchain-anchor.ts` | 再試行可能なoutbox worker entrypoint |
| `src/workers/payment-verification.ts` | JPYC receipt検証worker entrypoint |
| `src/index.ts` | `@hono/node-server`でHTTPサーバーを起動するエントリポイント |

スキーマ全体と運用方針は[データベーススキーマ設計書](../docs/design/database-schema.md)を参照。
