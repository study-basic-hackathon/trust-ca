# データベーススキーマ設計書

**基準日: 2026年8月13日**

本書は、TrustcaのCloud SQL for PostgreSQLとローカルPostgreSQLで共通利用するデータモデル、制約、索引、migration運用を定義する。SQLの正(source of truth)は[`backend/src/db/migrations/`](../../backend/src/db/migrations/)であり、本書は設計意図と利用境界を説明する。

対象読者: backend、インフラ、eKYC、カード検証、決済、ブロックチェーン連携の実装担当者。

---

## 1. 設計目標とスコープ

### 1.1 目標

1. 販売者eKYCからカード出品、注文、JPYC支払い、非同期オンチェーン記録までを同じPostgreSQLで関連付ける。
2. PSA Certの重複利用、同一カードの多重出品、ウォレットの二重紐付け、tx hashの再利用をDB制約でも拒否する。
3. eKYCのPII、画像本文、秘密鍵をDBへ保存しない。
4. ローカルとCloud SQLへ同じmigrationを再現可能な手順で適用する。
5. 業務transactionとブロックチェーン書き込みをtransactional outboxで分離する。

### 1.2 本Issueの対象外

- HTTP route、service、repositoryの業務実装
- 配送先住所、本人確認書類、顔画像の保存設計
- Cloud SQL instance、DB user、IAM、backup/PITRの実リソース作成
- 既存SQLiteデータの自動変換script
- 本番データの保持期間の最終決定

---

## 2. 共通規約

| 項目 | 規約 |
|---|---|
| DB engine | PostgreSQL。ローカル基準は16、Cloud SQLのmajor versionは接続前に確認 |
| Database / Schema | 原則はTrustca専用databaseの`public`。database共有が避けられない場合は`DATABASE_SCHEMA=trustca`等で分離 |
| ID | 業務entityはUUIDをNode.js側で生成。時系列eventだけidentity bigint |
| 日時 | `timestamp with time zone`。APIではUTCのRFC 3339へ変換 |
| 法定通貨 | `price_minor`等を`bigint`で保存。JPYでは1円=1 minor unit |
| ERC-20 | `amount_atomic`を`numeric(78,0)`で保存。`decimals`を別列で保持 |
| EVM address | `0x`付き小文字42文字。checksum表記は表示時に生成 |
| tx hash | `0x`付き小文字66文字。chain IDと組み合わせて一意 |
| Status | PostgreSQL enumではなく`varchar + CHECK`。追加は新migrationで行う |
| JSON | raw payloadではなく正規化結果だけを`jsonb`で保存 |
| 更新日時 | mutable tableの`updated_at`をDB triggerで自動更新 |
| 削除 | 取引・監査関係を壊す物理削除を避け、`status`で無効化 |

アプリのrepositoryは`bigint`と`numeric(78,0)`をJavaScript `number`へ変換せず、10進文字列または`bigint`として扱う。

---

## 3. 全体データモデル

### 3.1 アカウント・eKYC

```mermaid
erDiagram
    USERS ||--o| SELLER_PROFILES : "販売者登録"
    SELLER_PROFILES ||--o| SELLER_LIMITS : "条件付き制限"
    USERS ||--o{ WALLET_ACCOUNTS : "署名確認"
    USERS ||--o{ WALLET_AUTH_CHALLENGES : "challenge発行"
    SELLER_PROFILES ||--o{ SELLER_VERIFICATIONS : "eKYC申請"
    SELLER_VERIFICATIONS ||--o{ VERIFICATION_EVENTS : "状態履歴"
    USERS ||--o{ VERIFICATION_EVENTS : "運営者判断"
```

`webhook_events`は外部provider横断の受信台帳であり、特定verificationへの外部キーを必須にしない。未知sessionや署名不正の受信も監査対象として記録できるようにする。

### 3.2 カード・出品・決済

```mermaid
erDiagram
    USERS ||--o{ CARDS : "現在の所有者"
    PSA_VERIFICATIONS ||--o{ CARDS : "最新照会"
    CARDS ||--o{ CARD_IMAGES : "画像metadata"
    USERS ||--o{ CARD_IMAGES : "upload"
    CARDS ||--o{ CARD_IMAGE_ANALYSES : "補助解析"
    CARD_IMAGES ||--o{ CARD_IMAGE_ANALYSES : "解析対象"
    CARDS ||--o{ LISTINGS : "出品履歴"
    SELLER_PROFILES ||--o{ LISTINGS : "販売"
    LISTINGS ||--o{ ORDERS : "購入試行"
    USERS ||--o{ ORDERS : "購入"
    SELLER_PROFILES ||--o{ ORDERS : "販売snapshot"
    ORDERS ||--o{ PAYMENT_INTENTS : "支払い試行"
    WALLET_ACCOUNTS ||--o{ PAYMENT_INTENTS : "支払元"
    WALLET_ACCOUNTS ||--o{ PAYMENT_INTENTS : "受取先"
```

### 3.3 監査・非同期オンチェーン記録

```mermaid
erDiagram
    AUDIT_EVENTS ||--|| ONCHAIN_OUTBOX : "1 event = 1 anchor job"
```

`audit_events.aggregate_id`は複数種類の業務entityを指すpolymorphic IDであり、DB外部キーを持たない。`aggregate_type + aggregate_id`をrepositoryで必ずセットにして検索する。

---

## 4. Table一覧

### 4.1 アカウント・eKYC

| Table | 主な列 | 責務・制約 |
|---|---|---|
| `users` | `id`, `display_name`, `status` | 購入者を含むアカウント。退会は`withdrawn` |
| `seller_profiles` | `user_id`, `onboarding_status` | Trustcaとしての販売可否。eKYC provider statusとは分離 |
| `seller_limits` | `active_listing_limit`, `max_listing_amount_minor`, `withdrawal_hold_hours` | eKYC承認後の条件付き制限。負数不可 |
| `wallet_accounts` | `user_id`, `provider`, `chain_id`, `address_normalized`, `verified_at` | 署名確認済みwallet。`chain_id + address`で一意 |
| `wallet_auth_challenges` | `nonce_sha256`, `domain`, `expires_at`, `used_at` | 使い捨て署名challenge。nonce本文は保存しない |
| `seller_verifications` | `provider_session_id`, `status`, `checks`, `source` | PIIを除いたeKYC現在状態。販売者ごとの進行中sessionは1件 |
| `verification_events` | `event_type`, `from_status`, `to_status`, `source`, `reason` | eKYCのappend-only状態履歴 |
| `webhook_events` | `provider_event_id`, `payload_sha256`, `signature_valid`, `processed_at` | Webhook再送排除と処理監視。raw本文は保存しない |

`seller_profiles.onboarding_status`と`seller_verifications.status`は役割が異なる。前者はTrustcaの業務判断、後者はeKYCセッションの正規化状態である。例えばeKYCが`approved`でも、上限設定や運営者確認が未完了ならseller profileは`in_review`のままにできる。

### 4.2 カード・画像

| Table | 主な列 | 責務・制約 |
|---|---|---|
| `psa_verifications` | `cert_number`, `status`, カード属性, `checked_at`, `expires_at` | PSA照会履歴。TTL内の最新結果をcacheとして利用 |
| `cards` | `current_owner_id`, `psa_cert_number`, `latest_psa_verification_id`, `status` | 物理カード個体。PSA Certは全cardで一意。最新照会は同じCertだけを参照可能 |
| `card_images` | `storage_bucket`, `storage_object`, `sha256`, `capture_nonce` | 非公開GCS object metadata。画像本文は保存しない |
| `card_image_analyses` | `analysis_kind`, `provider`, `model`, `status`, `score`, `normalized_result` | Vision/Gemini/自社比較の補助結果。scoreは0..1、参照画像は同じcardに限定 |

`psa_verifications`は同じCertへの再照会履歴を複数保持する。一方、`cards.psa_cert_number`は一意であり、同じ番号を別の物理カードとして登録できない。売買完了時はcardを作り直さず`current_owner_id`を購入者へ更新する。

### 4.3 Marketplace・支払い

| Table | 主な列 | 責務・制約 |
|---|---|---|
| `listings` | `card_id`, `seller_id`, `price_minor`, `currency`, `status` | 出品履歴。1カードの`active/reserved`は1件 |
| `orders` | `listing_id`, `buyer_id`, `seller_id`, `price_minor`, `currency`, `status` | 購入時点の当事者・価格snapshot。自己購入不可、sellerはlistingと一致 |
| `payment_intents` | payer/payee wallet、chain/token/from/to/amount、`tx_hash`, `status` | receiptと照合する期待値。wallet/chain/addressを複合外部キーで固定し、`chain_id + tx_hash`で一意 |

`payment_intents`へブラウザ申告の金額・送金先をそのまま保存しない。backendがorder snapshot、販売者wallet、環境ごとのtoken addressから生成する。confirm時はreceiptのstatusと`Transfer` eventを照合する。

### 4.4 監査・outbox

| Table | 主な列 | 責務・制約 |
|---|---|---|
| `audit_events` | `idempotency_key`, aggregate, event, `canonical_payload`, `payload_sha256` | PIIを除いた改竄検知対象イベント |
| `onchain_outbox` | `status`, chain/contract, retry/lock, tx/block | audit eventと1対1の非同期anchor job |

---

## 5. 状態とDB制約

### 5.1 eKYC

```mermaid
stateDiagram-v2
    [*] --> not_started
    not_started --> in_progress
    not_started --> expired
    in_progress --> approved
    in_progress --> declined
    in_progress --> in_review
    in_progress --> abandoned
    in_progress --> expired
    in_review --> approved: 運営者判断
    in_review --> declined: 運営者判断
```

CHECK制約は未知の内部statusを拒否する。外部providerの未知statusはservice層で`in_review`へ正規化し、元の値を`provider_status`へ保存する。

### 5.2 出品・注文・支払い

```mermaid
stateDiagram-v2
    state Listing {
        [*] --> draft
        draft --> active
        active --> reserved
        reserved --> sold
        active --> closed
        reserved --> active: 予約解除
    }

    state Order {
        [*] --> pending_payment
        pending_payment --> payment_submitted
        payment_submitted --> paid
        paid --> completed
        pending_payment --> cancelled
        payment_submitted --> cancelled
        paid --> disputed
        disputed --> refunded
    }

    state Payment {
        [*] --> created
        created --> submitted
        submitted --> confirmed
        created --> expired
        submitted --> failed
    }
```

遷移順そのものはservice/repositoryで制御する。更新SQLは次のように期待する遷移元を`WHERE`へ含め、更新件数0を`409 CONFLICT`として扱う。

```sql
UPDATE listings
   SET status = 'reserved'
 WHERE id = $1
   AND status = 'active';
```

### 5.3 Outbox

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> processing
    retry --> processing
    processing --> submitted
    processing --> retry
    processing --> dead
    submitted --> confirmed
    submitted --> retry: receipt未確定・reorg確認
```

workerは`FOR UPDATE SKIP LOCKED`を使い、`pending/retry`かつ`next_attempt_at <= now()`の行を短いDB transactionでclaimする。RPC呼び出し中にDB lockを保持しない。

---

## 6. 重要なtransaction境界

### 6.1 JPYC支払い確認とoutbox作成

```mermaid
sequenceDiagram
    participant API as backend API
    participant RPC as Polygon RPC
    participant DB as PostgreSQL
    participant Worker as onchain worker

    API->>RPC: receipt・Transfer event取得
    RPC-->>API: chain/token/from/to/value/status
    API->>DB: BEGIN
    API->>DB: payment_intentsをsubmitted→confirmed
    API->>DB: ordersをpayment_submitted→paid
    API->>DB: audit_events追加
    API->>DB: onchain_outbox追加
    API->>DB: COMMIT
    Note over API,DB: 4更新は全成功または全rollback
    Worker->>DB: outboxをSKIP LOCKEDでclaim
    Worker->>RPC: audit event hashを非同期記録
    Worker->>DB: tx hash / block / confirmedを更新
```

外部RPCをDB transaction内で呼ばない。receiptは先に取得し、DB transactionでは検証済み結果の反映だけを行う。ただしcommit直前にchain状態が変わる可能性へ備え、confirmation数とreorg確認はworker/confirm serviceで別途扱う。

### 6.2 eKYC状態更新

同一transactionで次を行う。

1. `seller_verifications`を期待する元status付きで更新
2. `verification_events`へ状態差分を追加
3. Trustcaとしての判断が変わる場合だけ`seller_profiles`を更新
4. オンチェーン監査対象なら`audit_events`と`onchain_outbox`を追加

Webhookの重複排除は、このtransactionより前に`webhook_events`の一意制約で行う。

---

## 7. Index・一意制約

| 目的 | Index / Constraint |
|---|---|
| 同一walletの別ユーザー紐付け防止 | `wallet_accounts(chain_id, address_normalized)` unique |
| 同一販売者の進行中eKYCを1件へ制限 | `seller_verifications(seller_id)` partial unique |
| Webhook再送排除 | provider event ID / payload SHA-256のpartial unique |
| PSA cache取得 | `psa_verifications(cert_number, checked_at DESC)` |
| Cert番号流用防止 | `cards(psa_cert_number)` partial unique (NULL以外) |
| 同一カードの多重公開防止 | `listings(card_id)` partial unique (`active/reserved`) |
| 公開出品一覧 | `listings(published_at DESC, id)` partial (`active`) |
| 注文履歴 | buyer / seller + `created_at DESC` |
| tx hash再利用防止 | `payment_intents(chain_id, tx_hash)` partial unique |
| 支払い期限切れ処理 | `payment_intents(expires_at)` partial (`created/submitted`) |
| 監査履歴 | aggregate type/id + occurred_at |
| outbox worker polling | `next_attempt_at, created_at, audit_event_id` partial (`pending/retry`) |

---

## 8. PII・秘密情報・保持方針

### 8.1 保存しないデータ

- eKYC: 氏名、住所、生年月日、身分証番号、身分証画像、顔画像
- 画像: base64本文、公開URL
- Web3: private key、seed phrase、署名前/署名済みraw transaction
- 外部連携: API key、Bearer Token、Webhook secret
- 配送: 住所・電話番号（別Issueで暗号化と保持期限を設計するまで対象外）

### 8.2 JSONB allowlist

| 列 | 許可する内容 | 禁止する内容 |
|---|---|---|
| `seller_verifications.checks` | document/liveness/face match等の`passed/failed/in_review/not_run` | 氏名、document number、画像 |
| `psa_verifications.normalized_result` | カード名、年、ブランド、グレード等の表示許可項目 | Authorization、不要なraw response |
| `card_image_analyses.normalized_result` | OCR候補、領域、差分理由、model metadata | 画像base64 |
| `audit_events.canonical_payload` | event ID、aggregate ID、status、金額、tx hash等の明示allowlist | eKYC/配送PII、secret |

保持期間は本番前に法務・運用と決定する。`card_images.retention_until`等の期限を過ぎた削除jobは、DB行とGCS objectの整合を取りながら実装する。

---

## 9. Migration設計

### 9.1 ファイルと履歴

```text
backend/src/db/migrations/
└── 0001_initial_schema.sql
```

ファイル名は`4桁version_snake_case.sql`とする。runnerは`schema_migrations`へ次を記録する。

| 列 | 内容 |
|---|---|
| `version` | `0001`等の単調増加version |
| `filename` | 適用したファイル名 |
| `checksum` | SQL全文のSHA-256 |
| `applied_at` | 適用日時 |

適用済みファイルは編集しない。変更が必要な場合は新しいversionを追加する。checksum不一致、適用済みファイルの欠落、過去versionの後付けはrunnerが停止する。

### 9.2 実行フロー

```mermaid
flowchart TD
    Start[pnpm db:migrate] --> Load[SQLをversion順に読込・SHA-256算出]
    Load --> Connect[PostgreSQLへ専用Clientで接続]
    Connect --> Lock[advisory lock取得]
    Lock --> Compare[schema_migrationsと比較]
    Compare -->|checksum不一致| Stop[失敗して停止]
    Compare -->|未適用あり| Begin[BEGIN]
    Begin --> Apply[SQL適用]
    Apply --> History[履歴INSERT]
    History --> Commit[COMMIT]
    Commit --> Compare
    Compare -->|未適用なし| Unlock[lock解除・正常終了]
    Apply -->|SQL error| Rollback[ROLLBACK・失敗終了]
```

### 9.3 コマンド

```bash
cd backend
pnpm db:migrate
pnpm db:migrate:status
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trustca pnpm test:db
```

`test:db`はランダム名の`trustca_migration_test_*` schemaを作り、初回/再実行、全table、主要制約、checksumを検証した後、その一時schemaだけを削除する。

---

## 10. Docker Compose / Cloud SQL運用

### 10.1 ローカル

Docker Composeではone-shotの`migrate` serviceが`db`のhealthcheck完了を待ち、migration成功後にだけbackendを起動する。

```text
db healthy → migrate completed successfully → backend healthy → frontend
```

### 10.2 Cloud SQL

本番ではCloud Run serviceの各instance起動時にmigrationを実行しない。次の順にデプロイする。

1. Cloud SQLのbackup/PITR状態と対象instanceのPostgreSQL major versionを確認
2. 原則としてTrustca専用databaseを作成する。database共有が避けられない場合は専用schemaと`DATABASE_SCHEMA`を設定する
3. migration専用DB roleでCloud Run Job等から`pnpm db:migrate`
4. `pnpm db:migrate:status`相当で未適用0件を確認
5. backendの新revisionをデプロイ
6. smoke test後にtrafficを切替

推奨権限分離:

| Role | 権限 |
|---|---|
| migration role | schema内DDL、table/index/trigger作成、migration履歴更新 |
| runtime role | 必要tableのSELECT/INSERT/UPDATE。原則DROP/ALTERなし |
| readonly role | 運営者調査用の限定SELECT。PIIを持たないviewを将来検討 |

接続はCloud SQL ConnectorまたはCloud RunのCloud SQL接続を使い、接続文字列/DB passwordはSecret Managerで管理する。

---

## 11. SQLite PoCからの対応

| `poc/ekyc/` | PostgreSQL | 主な変更 |
|---|---|---|
| `sellers` | `users` + `seller_profiles` + `seller_limits` | 購入者共通accountと販売者固有状態を分離 |
| `seller_verifications` | `seller_verifications` | UUID主キー追加、provider/sessionを分離、`checks`をjsonb化 |
| `verification_events` | `verification_events` | verification UUID外部キー、運営者actor/reason追加 |
| `webhook_logs` | `webhook_events` | raw payload保存をやめ、event ID/payload hashで重複排除 |

PoCは参照専用のため変更しない。backendへのeKYC移植Issueでrepositoryとデータ移行手順を追加する。

---

## 12. 未決定事項

| 項目 | 暫定方針 | 決定期限 |
|---|---|---|
| Cloud SQL major version | ローカルは16。SQL適用前に既存instanceを確認 | Cloud SQL接続前 |
| backup/PITR | 本番migration前に有効化状況を確認 | 初回本番deploy前 |
| データ保持期間 | 期限列を用意し、具体日数は法務・運用と決定 | 実ユーザー受入前 |
| 配送先PII | 本schemaへ未追加。暗号化、閲覧権限、削除期限を別設計 | 配送機能実装前 |
| RLS | MVPはbackend service accountだけが接続。必要性を再評価 | 管理画面/分析接続前 |
| Partitioning | 初期は不要。Webhook/audit件数を計測して判断 | 100万event到達前 |

---

## 13. 関連資料

- [system-architecture.md](./system-architecture.md) — 全体構成とCloud SQLの位置づけ
- [ekyc-design.md](./ekyc-design.md) — PII最小化とeKYC status
- [seller-onboarding-review-flow.md](./seller-onboarding-review-flow.md) — 販売者審査フロー
- [folder-structure.md](./folder-structure.md) — migration/repositoryの配置規則
- [specs/014-db-schema/](../../specs/014-db-schema/) — Issue #14の仕様、判断、検証手順
