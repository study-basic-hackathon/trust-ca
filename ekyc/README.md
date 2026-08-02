# Trust-CA eKYC 検証アプリ

高額トレカ・マーケットプレイス構想の第一段階: **Didit の本番APIを使った販売者本人確認(eKYC)フローの実験実装**。モックなし、ローカルサーバーで完結。

## フロー

```
販売者登録 → POST /v3/session/ (Didit) → Hosted Flow で身分証+ライブネス+顔照合
  → コールバック/ポーリング/Webhook で結果取得 → 正規化してSQLiteに保存 → バッジ表示
```

- **結果の真実のソースはサーバー間通信のみ**(署名検証済みWebhook、または `GET /v3/session/{id}/decision/` のポーリング)。ブラウザのリダイレクトは信用しない。
- **PIIは保存しない**。身分証画像・氏名等はDidit側に残し、自社DBにはセッションID・正規化ステータス・各チェック結果のみ保存。

## セットアップ

1. https://business.didit.me/ でアカウント作成(無料、カード不要)
2. コンソールでワークフローを作成: **ID Verification + Liveness + Face Match**(必要なら IP Analysis)
3. Application の **API Key** とワークフローの **Workflow ID** を控える
4. 環境変数を設定:

```bash
cp .env.example .env.local
# DIDIT_API_KEY と DIDIT_WORKFLOW_ID を記入
```

5. 起動:

```bash
pnpm install
pnpm dev
# → http://localhost:3000
```

## ローカル検証の動き

- Webhookはlocalhostに届かないため、`in_progress` の間は **5秒ごとに decision API をポーリング**して状態を反映する(UIの「最新状態を取得」でも手動取得可)。
- Webhookも検証したい場合: `ngrok http 3000` で公開URLを作り、Diditコンソールで Webhook URL を `https://<ngrok>/api/webhooks/didit` に設定、発行される `secret_shared_key` を `DIDIT_WEBHOOK_SECRET_KEY` に設定。受信ログはUI下部の監査パネルに出る。

## テスト

```bash
pnpm vitest run            # 署名検証・正規化のユニットテスト
pnpm vitest run --coverage # カバレッジ (lib 80%+ を強制)
```

## 構成

| パス | 役割 |
|---|---|
| `src/lib/didit/signature.ts` | Webhook署名検証 (X-Signature-V2 → Simple → raw、±300秒) |
| `src/lib/didit/normalize.ts` | Diditステータス→内部ステータス正規化。未知ステータスは `in_review` に落とす(勝手に承認しない) |
| `src/lib/didit/client.ts` | セッション作成 / decision取得 (サーバー側のみ) |
| `src/lib/db.ts` | SQLite (sellers / seller_verifications / webhook_logs) |
| `src/app/api/kyc/session` | Diditセッション作成 |
| `src/app/api/kyc/status` | ステータス取得 (+ `refresh=1` でポーリング) |
| `src/app/api/webhooks/didit` | 署名検証付きWebhook受信 |

## 注意

- テストで使う身分証は**同意した本人の正規の書類のみ**。架空・加工・他人の身分証は使わない。
- DBファイルは `data/ekyc.db`(gitignore済)。リセットは `rm -rf data/`。
