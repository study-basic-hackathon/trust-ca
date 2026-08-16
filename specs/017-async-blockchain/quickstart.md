# Quickstart: 非同期オンチェーン記録MVP

## 1. Local E2E

```bash
cp .env.example .env
```

`.env`の`ONCHAIN_MVP_ENABLED=false`を`true`へ変更し、repository rootで起動する。

```bash
docker compose --profile blockchain up --build
```

別terminalで実行する。

```bash
cd backend
BACKEND_URL=http://localhost:8080 \
ONCHAIN_RPC_URL=http://localhost:8545 \
ONCHAIN_INTERNAL_TOKEN=local-onchain-internal-token-change-me \
pnpm test:onchain:e2e
```

成功時はoutbox登録、API冪等性、receipt、contract hash一致の4項目を表示する。

## 2. PostgreSQL integration test

```bash
cd backend
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trustca \
pnpm test:onchain:db
```

ランダム名の一時schemaだけを作成・削除し、`public`は変更しない。

## 3. Package tests

```bash
cd backend
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../blockchain
pnpm build
pnpm test
```

## 4. Port conflict

既存serviceと競合する場合は`.env`で`DB_PORT`、`BACKEND_PORT`、`CHAIN_RPC_PORT`を変更する。E2Eの`BACKEND_URL`と`ONCHAIN_RPC_URL`も同じhost portへ合わせる。

Hardhatの公開開発keyはlocal profile専用であり、Amoy/mainnetへ流用しない。
