# Quickstart: JPYC決済MVP

## 1. 準備

```bash
cp .env.example .env
```

`.env`で次を設定する。

```dotenv
PAYMENT_MVP_ENABLED=true
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=<Dashboardで発行したclient ID>
```

## 2. 起動

```bash
docker compose --profile blockchain up --build
```

- UI: `http://localhost:3000/payments/demo`
- API: `http://localhost:8080`
- local RPC: `http://localhost:8545`

## 3. 自動検証

```bash
docker compose exec \
  -e BACKEND_URL=http://localhost:8080 \
  -e PAYMENT_RPC_URL=http://chain:8545 \
  backend pnpm test:payment:e2e
```

成功時はSIWE認証、intentの冪等作成、JPYC transfer、worker確定blockが順に表示される。

## 4. 個別test

```bash
cd backend && pnpm typecheck && pnpm lint && pnpm test
cd ../blockchain && pnpm build && pnpm test
cd ../frontend && pnpm lint && pnpm build
```

本番tokenや実資金では実行しない。mainnet移行条件は[設計書](../../docs/design/jpyc-payment.md#13-本番移行条件)を参照する。
