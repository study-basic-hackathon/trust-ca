# Quickstart: 販売者登録フロー

## 1. 環境変数

`backend/.env.example`に、既存の`ONCHAIN_MVP_ENABLED`/`PAYMENT_MVP_ENABLED`と同じ形式で追加する。

```bash
# Didit eKYC MVP。通常のbackend開発時は無効のままにする。
DIDIT_MVP_ENABLED=false
DIDIT_API_KEY=
DIDIT_WORKFLOW_ID=
DIDIT_WEBHOOK_SECRET_KEY=
# 運営者向けAPI用の共有シークレット。32文字以上のrandom値に置き換える。
ADMIN_API_TOKEN=
```

`DIDIT_MVP_ENABLED=false`のままでも販売者の登録・公開情報取得(`POST /api/v1/sellers`, `GET /api/v1/sellers/{sellerId}`)は動作する。KYCセッション作成・Webhook受信はDidit APIキーが必要なため、実際に本人確認まで通しで確認する場合だけ`true`にして値を設定する。

## 2. Docker Composeでの起動

```bash
cp .env.example .env
docker compose up --build
```

`db healthy → migrate completed → backend healthy → frontend`の順で起動する(既存構成のまま、追加のmigrationはない)。

## 3. 登録〜本人確認開始のスモークテスト

```bash
# 1. 販売者登録
curl -s -X POST http://localhost:8080/api/v1/sellers \
  -H "Content-Type: application/json" \
  -d '{"displayName":"テスト販売者"}' | tee /tmp/seller.json

SELLER_ID=$(jq -r '.data.id' /tmp/seller.json)

# 2. 本人確認セッション作成(DIDIT_MVP_ENABLED=trueかつ有効なAPIキーが必要)
curl -s -X POST "http://localhost:8080/api/v1/sellers/${SELLER_ID}/kyc-sessions" | tee /tmp/session.json

# 3. 状態取得(pollを兼ねる)
curl -s "http://localhost:8080/api/v1/sellers/${SELLER_ID}/verification"
```

## 4. Webhook受信の確認(署名検証)

DiditダッシュボードからのWebhookをローカルへ転送するか、`poc/ekyc/`の署名生成ロジックを参考に、`X-Signature-V2`・`X-Timestamp`を付与したテストリクエストを送る。

```bash
curl -s -X POST http://localhost:8080/api/v1/webhooks/didit \
  -H "Content-Type: application/json" \
  -H "X-Signature-V2: <計算した署名>" \
  -H "X-Timestamp: $(date +%s)" \
  -d @/tmp/decision-payload.json
```

署名が無効な場合は`401`が返り、`webhook_events`には`signature_valid=false`で記録される(状態は更新されない)。

## 5. 運営者による審査中の確定

```bash
curl -s http://localhost:8080/api/v1/admin/verifications \
  -H "Authorization: Bearer ${ADMIN_API_TOKEN}"

curl -s -X POST "http://localhost:8080/api/v1/admin/verifications/${SESSION_ID}/decision" \
  -H "Authorization: Bearer ${ADMIN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","reason":"本人確認書類を目視確認済み"}'
```

`Authorization`ヘッダーがない、またはtokenが一致しない場合は拒否される。対象セッションが既に`approved`/`declined`で確定済みの場合も拒否される。

## 6. Package tests

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

DBを伴う制約確認は、既存の統合テストパターンに合わせて追加する。

```bash
cd backend
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trustca pnpm test:db
```

## 7. ポート競合

既存service(`DB_PORT`/`BACKEND_PORT`/`FRONTEND_PORT`)と競合する場合は、リポジトリルートの`.env`で変更する。本機能はこれらのポート変更をそのまま利用でき、追加のポートは使わない。
