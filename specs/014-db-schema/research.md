# Research: PostgreSQLスキーマ基盤

## 1. DBエンジン

**Decision**: PostgreSQLを採用し、ローカル検証基準をPostgreSQL 16とする。

**Rationale**: 現行backendが`pg`を利用し、Docker Composeも`postgres:16-alpine`で統一済みである。Cloud SQL for PostgreSQLへ同じSQLを適用できる。

**Alternatives considered**:

- MySQL: 現行コード・Composeと不一致であり、partial index、`jsonb`、advisory lock等の設計を変更する必要がある。
- ORMによるschema生成: 現時点でORMは未採用であり、SQL制約と索引を明示的にレビューしにくくなる。

## 2. Migration方式

**Decision**: 番号付きSQLファイルと小さなNode.js runnerを採用する。

**Rationale**: 新しいruntime dependencyを増やさず、Cloud SQL、Docker Compose、CIから同じコマンドを使える。SQLをsource of truthとしてレビューできる。

Runnerは次を保証する。

- version順の適用
- 1ファイル1transaction
- advisory lockによる同時実行防止
- SHA-256 checksumによる適用済みファイル改変検知
- `schema_migrations`による履歴管理

**Alternatives considered**:

- アプリ起動時に無条件でmigration: Cloud Runの複数instance起動と責務が混ざるため不採用。本番はCloud Run Job等で先に実行する。
- Prisma/Drizzle migration: 将来のrepository実装で再評価可能だが、Issue #14のためだけにORMを固定しない。

## 3. 主キー

**Decision**: 業務entityはアプリ生成UUID、順序性が必要なappend-only eventはidentity bigintとする。

**Rationale**: `pgcrypto`等のextension権限へ依存せず、APIで先にIDを確定できる。イベント履歴は挿入順での閲覧が多いためbigintを使う。

## 4. Status表現

**Decision**: PostgreSQL enumではなく`varchar + CHECK`を使う。

**Rationale**: ハッカソン期間中は状態追加が起こりやすい。enum変更より通常migrationで制約を置換する方がロールアウトを管理しやすい。外部の未知statusは保存前に内部`in_review`へ正規化する。

## 5. 金額とWeb3値

**Decision**:

- JPY等の法定通貨: minor unitを`bigint`
- ERC-20: atomic unitを`numeric(78,0)`
- address / tx hash: lowercase hex文字列
- chain ID: 正のinteger
- block number: `numeric(78,0)`

**Rationale**: JavaScript floating pointと`number`の安全整数範囲を避け、EVM uint256を欠損なく保存する。

## 6. eKYCとPII

**Decision**: provider session ID、内部status、個別check結果、取得経路、イベントだけを保存する。

**Rationale**: `docs/design/ekyc-design.md`の最小化原則に従い、氏名、住所、生年月日、身分証番号、身分証/顔画像を保持しない。Webhook本文も原則保存せず、payload hashと正規化metadataを保存する。

## 7. PSA Cert重複

**Decision**: PSA照会履歴は複数保持する一方、`cards.psa_cert_number`は全カードで一意にする。

**Rationale**: API再照会履歴を残しながら、同じ番号を複数の物理カードへ流用する出品をDBで拒否する。所有者変更は新しいcardを作らず`current_owner_id`を更新する。

## 8. 非同期オンチェーン記録

**Decision**: `audit_events`と`onchain_outbox`を1対1に分け、同じ業務transactionで作成する。

**Rationale**: 業務イベントは確定済み事実、outboxは配送状態であり更新頻度と責務が異なる。workerは`pending/retry`を索引で取得し、`submitted/confirmed/dead`まで追跡する。

## 9. Cloud SQL運用

**Decision**: migrationはCloud Run service起動処理に含めず、デプロイ前のCloud Run Jobまたは明示的な運用コマンドで実行する。ローカルComposeだけはone-shot migration serviceをbackendの前に実行する。

**Rationale**: 本番serviceの起動時間と権限を小さく保ち、migration失敗時に新revisionへのtraffic切替を止められる。
