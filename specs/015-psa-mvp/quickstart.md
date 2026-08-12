# Quickstart: PSA証明書照会MVP

## 1. 環境変数

```bash
cp .env.example .env
```

`.env`にPSAから発行されたトークンを設定する。

```dotenv
PSA_MVP_ENABLED=true
PSA_API_TOKEN=<token>
```

## 2. 起動

```bash
docker compose up --build
```

- UI: http://localhost:3000
- API: http://localhost:8080/api/v1/cards/psa-verifications

## 3. API確認

```bash
curl -X POST http://localhost:8080/api/v1/cards/psa-verifications \
  -H 'Content-Type: application/json' \
  -d '{"certNumber":"12345678"}'
```

## 4. トークンなしの検証

PSA上流はテスト内でモックするため、トークンなしで実行できる。

```bash
cd backend
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../frontend
pnpm lint
pnpm build
```

## 5. 注意

- `PSA_API_TOKEN`をコミットしない。
- 公開環境では認証・分散レート制限を追加するまで`PSA_MVP_ENABLED=false`を維持する。
- 画面の「PSA登録情報確認済み」は、カード現物の真正性保証ではない。
