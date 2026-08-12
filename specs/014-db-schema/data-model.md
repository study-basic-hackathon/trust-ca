# Data Model: PostgreSQLスキーマ基盤

## Entity groups

### Account / eKYC

| Entity | Responsibility | Key constraints |
|---|---|---|
| `users` | 購入者を含むアカウント | 物理削除せずstatus管理 |
| `seller_profiles` | 販売者審査と利用状態 | `users`と1対1 |
| `seller_limits` | 条件付き出品制限 | 負数不可、販売者と1対1 |
| `wallet_accounts` | 署名確認済みEVM address | chain + addressで一意 |
| `wallet_auth_challenges` | 使い捨て署名nonce | nonce hash一意、期限必須 |
| `seller_verifications` | eKYC最新状態 | provider session一意、進行中sessionは販売者ごと1件 |
| `verification_events` | eKYC状態変更履歴 | append-only運用 |
| `webhook_events` | 外部Webhook受信履歴 | provider event ID / payload hashで重複排除 |

### Card / marketplace

| Entity | Responsibility | Key constraints |
|---|---|---|
| `psa_verifications` | PSA照会履歴と正規化結果 | Cert + checked_at検索index |
| `cards` | 物理カード個体 | PSA Certは全cardで一意 |
| `card_images` | 非公開GCS object metadata | bucket + object一意、SHA-256形式 |
| `card_image_analyses` | Vision/Gemini等の補助結果 | scoreは0..1、未知結果は`in_review` |
| `listings` | 出品と価格 | active/reservedはcardごと1件 |
| `orders` | 取引当事者と価格snapshot | active orderはlistingごと1件、自己購入不可 |

### Payment / audit

| Entity | Responsibility | Key constraints |
|---|---|---|
| `payment_intents` | ERC-20支払い期待値とreceipt結果 | payer/payee walletとaddressを一致、chain + tx hash一意、atomic amountは整数 |
| `audit_events` | 正規化済み業務イベント | idempotency key一意、payload hash必須 |
| `onchain_outbox` | 非同期anchor配送状態 | audit eventと1対1、chain + tx hash一意 |

## State models

### Seller verification

```text
not_started -> in_progress -> approved
                          -> declined
                          -> in_review -> approved / declined
                          -> abandoned
not_started / in_progress -> expired
```

### Listing / order / payment

```text
listing: draft -> active -> reserved -> sold
                      \-> closed

order: pending_payment -> payment_submitted -> paid -> completed
                      \-> cancelled / disputed / refunded

payment: created -> submitted -> confirmed
                \-> failed / expired
```

状態遷移そのものはservice層で期待する遷移元を`WHERE`へ含めて制御する。DBのCHECKは未知の状態値だけを拒否する。

### Onchain outbox

```text
pending -> processing -> submitted -> confirmed
                   \-> retry -> processing
                   \-> dead
```

## Transaction boundaries

| Business operation | Same transaction |
|---|---|
| eKYC result update | `seller_verifications`更新 + `verification_events`追加 + 必要な`audit_events`/`onchain_outbox`追加 |
| Order creation | listingの期待status更新 + `orders`追加 |
| Payment confirmation | `payment_intents`更新 + `orders`更新 + `audit_events`/`onchain_outbox`追加 |
| Worker claim | `SELECT ... FOR UPDATE SKIP LOCKED` + outboxを`processing`へ更新 |

## Data minimization

DBへ保存しないもの:

- eKYCの氏名、住所、生年月日、身分証番号、身分証画像、顔画像
- カード画像本体（Cloud Storageへ保存）
- ウォレット秘密鍵、署名前transaction、API key、Webhook secret
- 配送先住所（本Issueでは未設計）

保持するJSONBはproviderのraw payloadではなく、用途を限定した正規化結果とcanonical audit payloadに限定する。
