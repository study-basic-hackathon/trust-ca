# Feature Specification: PostgreSQLスキーマ基盤

**Feature Branch**: `feat/14-db-schema`

**Created**: 2026-08-13

**Status**: Complete

**Input**: User description: "Cloud SQL for PostgreSQLを前提に、Trustca全体のDBスキーマを設計・作成する"

## User Scenarios & Testing

### User Story 1 - 同じ手順でDBを初期化できる (Priority: P1)

開発者は、空のPostgreSQLへ単一コマンドで必要なテーブル、制約、索引を作成できる。同じコマンドを再実行しても適用済みmigrationは重複実行されない。

**Why this priority**: すべてのbackend機能が依存する土台であり、ローカルとCloud SQLで作成手順が異なると再現性が失われるため。

**Independent Test**: 空の一時schemaへmigrationを2回実行し、1回目だけが適用され、2回目は変更なしで終了することを確認する。

**Acceptance Scenarios**:

1. **Given** 空のPostgreSQL、**When** `pnpm db:migrate`を実行する、**Then** migration履歴と全業務テーブルが作成される。
2. **Given** 最新migration適用済みのDB、**When** 同じコマンドを再実行する、**Then** DDLは再実行されず正常終了する。
3. **Given** 適用済みmigrationファイルの内容が変更された状態、**When** migrationを実行する、**Then** checksum不一致として停止する。

---

### User Story 2 - 業務データを安全な関係で保存できる (Priority: P1)

backend実装者は、販売者eKYC、カード検証、出品、注文、ウォレット、JPYC決済を、外部キーと一意制約で関連付けて保存できる。

**Why this priority**: 重複Cert、tx hash再利用、同一カードの多重出品等をアプリの実装漏れだけに任せず、DBでも拒否する必要があるため。

**Independent Test**: 正常な最小データを登録した後、重複ウォレット、重複PSA Cert、同一カードの多重出品、不正なEVM addressがDB制約で拒否されることを確認する。

**Acceptance Scenarios**:

1. **Given** eKYC承認済み販売者とカード、**When** 出品と注文を保存する、**Then**販売者・購入者・価格snapshotの関係が保持される。
2. **Given** 既に別カードへ紐付いたPSA Cert、**When** 同じ番号でカードを作成する、**Then** unique violationになる。
3. **Given** 既に確認へ利用されたchain IDとtx hash、**When** 別のpayment intentへ設定する、**Then** unique violationになる。
4. **Given** 不正形式のaddressまたはhash、**When** 保存する、**Then** check violationになる。

---

### User Story 3 - 業務確定と非同期上チェーンを分離できる (Priority: P2)

backend実装者は、業務イベントとオンチェーンoutboxを同じDB transactionで作成し、workerは再試行可能な状態として処理できる。

**Why this priority**: ブロックチェーン障害で購入/eKYC等の主要フローを止めず、かつDB確定済みイベントの配送漏れを回収するため。

**Independent Test**: audit eventとoutboxを登録し、未処理検索用索引、1イベント1outbox制約、再試行状態・tx hash保存列が存在することを確認する。

**Acceptance Scenarios**:

1. **Given** 業務状態変更transaction、**When** audit eventとoutboxを同時登録する、**Then** 両方がcommitされるか両方がrollbackされる。
2. **Given** 同じaudit event、**When** outboxを二重作成する、**Then** primary key制約で拒否される。
3. **Given** `pending`または`retry`のoutbox、**When** workerが処理対象を検索する、**Then** `next_attempt_at`順に効率よく取得できる。

### Edge Cases

- migration途中でSQLエラーが発生した場合、そのファイルの変更と履歴登録を同じtransactionでrollbackする。
- 複数プロセスが同時にmigrationを開始した場合、PostgreSQL advisory lockで直列化する。
- 未知の外部ステータスをDBの承認状態へ直接保存しない。backendで`in_review`へ正規化してから保存する。
- Webhook再送はprovider event IDまたはpayload hashで重複排除する。
- ユーザー退会時も監査・取引整合性を壊す物理削除は行わず、状態を`withdrawn`へ変更する。
- 金額、ERC-20 atomic amount、chain ID、block numberの上限をJavaScript `number`に依存しない。

## Requirements

### Functional Requirements

- **FR-001**: migrationはファイル名順に適用し、version、filename、SHA-256 checksum、適用日時を記録しなければならない。
- **FR-002**: 1つのmigrationファイルは1つのDB transactionで適用しなければならない。
- **FR-003**: migrationの同時実行はadvisory lockで直列化しなければならない。
- **FR-004**: 適用済みversionのchecksumがローカルファイルと異なる場合は処理を中断しなければならない。
- **FR-005**: `backend/src/db.ts`以外でアプリ用の`pg.Pool`を作成してはならない。
- **FR-006**: 主キーはアプリ側で生成するUUIDを基本とし、順序性が必要なイベント履歴だけidentity bigintを使用する。
- **FR-007**: 日時はすべて`timestamp with time zone`で保存しなければならない。
- **FR-008**: 法定通貨金額はminor unitの`bigint`、ERC-20量は`numeric(78,0)`で保存しなければならない。
- **FR-009**: EVM addressとtx hashは小文字hexへ正規化したうえでDB制約を適用しなければならない。
- **FR-010**: eKYCの氏名、住所、生年月日、身分証番号、顔画像を自社DBへ保存してはならない。
- **FR-011**: 販売者verificationはprovider session IDを一意にし、同一販売者の進行中sessionを1件に制限しなければならない。
- **FR-012**: Webhookはprovider event IDとpayload hashの両方で再送重複を検知できなければならない。
- **FR-013**: 1つのPSA Certは1つの物理カードだけへ紐付けられなければならない。
- **FR-014**: 1つのカードに同時に存在できる公開/予約中listingは1件でなければならない。
- **FR-015**: 注文にはlisting価格、通貨、販売者をsnapshotとして保存しなければならない。
- **FR-016**: paymentのpayer/payee wallet、chain、from/to addressは一致し、tx hashはchain単位で一意でなければならない。
- **FR-017**: audit eventは安定したidempotency keyとcanonical payload hashを持たなければならない。
- **FR-018**: onchain outboxはaudit eventと1対1で、再試行回数、次回実行時刻、lock、tx hash、block numberを保存できなければならない。
- **FR-019**: mutable tableの`updated_at`はDB triggerで更新されなければならない。
- **FR-020**: Docker Compose起動時にbackendより先にmigrationが完了しなければならない。
- **FR-021**: migrationと主要制約を一時schemaで検証し、検証後にそのschemaだけを削除できなければならない。

### Key Entities

- **User / Seller Profile / Seller Limit**: 購入者を含むアカウント、販売者審査状態、条件付き出品制限。
- **Wallet Account / Auth Challenge**: ユーザーと署名検証済みEVM address、使い捨てnonce。
- **Seller Verification / Verification Event / Webhook Event**: PIIを除いたeKYC現在状態と監査履歴、Webhook配送履歴。
- **PSA Verification / Card / Card Image / Image Analysis**: PSA照会履歴、物理カード個体、非公開画像metadata、補助解析結果。
- **Listing / Order**: 出品状態と購入時点の価格・当事者snapshot。
- **Payment Intent**: JPYC等ERC-20のpayer/payee wallet、期待値、receipt確認結果。
- **Audit Event / Onchain Outbox**: 改竄検知対象の正規化イベントと非同期オンチェーン記録状態。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 空のローカルPostgreSQLへ60秒以内に全migrationを適用できる。
- **SC-002**: 同じmigrationを2回連続実行し、2回目の適用件数が0件になる。
- **SC-003**: migration統合テストで、想定する全テーブルの存在と主要なunique/check制約を自動確認できる。
- **SC-004**: Schema設計書から全テーブルの責務、主な関係、保持するPIIの境界を確認できる。
- **SC-005**: backendのlint、typecheck、unit test、buildがすべて成功する。

## Assumptions

- 本番DBはGCP Cloud SQL for PostgreSQL。ローカル基準はPostgreSQL 16とする。
- 本番Cloud SQLの正確なmajor version、接続方式、migration実行用IAM/DB roleはデプロイ前に確認する。
- UUIDはNode.jsの`crypto.randomUUID()`等でアプリ側生成し、DB extensionへ依存しない。
- 画像本体はCloud Storageへ保存し、DBにはobject metadataとhashだけを保存する。
- 住所・配送先の保存は本Issueの対象外とし、必要になった時点で暗号化・保持期限を含めて別設計する。
- HTTP APIとrepository実装は各機能Issueで追加し、本Issueでは永続化契約とmigration基盤までを対象とする。
