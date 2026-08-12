# Implementation Plan: PostgreSQLスキーマ基盤

**Branch**: `feat/14-db-schema` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

## Summary

Cloud SQL for PostgreSQLとローカルPostgreSQLへ共通適用できるmigration基盤を追加し、eKYC、カード、出品、注文、ウォレット/JPYC、監査outboxの初期schemaを作成する。SQLは番号付きファイルで管理し、Node.js runnerがtransaction、advisory lock、checksumを保証する。

## Technical Context

**Language/Version**: SQL (PostgreSQL 16基準)、JavaScript ES Modules (Node.js 24)

**Primary Dependencies**: `pg` 8系（既存dependencyのみ）

**Storage**: GCP Cloud SQL for PostgreSQL / ローカル`postgres:16-alpine`

**Testing**: Vitest（既存unit test）、一時PostgreSQL schemaを使うmigration integration test

**Target Platform**: Cloud Run backend、Cloud Run Job、Docker Compose

**Project Type**: Web API backendのデータ基盤

**Performance Goals**: workerの未処理outbox検索、公開listing検索、注文・verification履歴検索がindex scan可能であること

**Constraints**: PII最小化、ORM追加なし、`backend/src/db.ts`だけがアプリ用Poolを所有、既存PoCは変更しない

**Scale/Scope**: MVPの17業務テーブル + migration履歴、初期数万件規模を想定

## Constitution Check

| Principle | 判定 | 対応 |
|---|---|---|
| I. FE/BE責務分離 | PASS | 変更はbackendと設計文書のみ。frontendへ業務ロジックを追加しない |
| II. フォルダ構成 | PASS | SQLは`backend/src/db/migrations/`、運用scriptは`backend/scripts/`へ配置し、構成文書も更新する |
| III. PoC参照専用 | PASS | `poc/ekyc/`は読み取り参照のみで変更しない |
| IV. 信頼設計 | PASS | PII最小化、未知statusの非承認、外部結果の正規化をschemaへ反映する |
| V. Pool一元管理 | PASS | アプリ用Poolは既存`backend/src/db.ts`のまま。migrationは短命な専用Clientを使用する |

## Project Structure

### Documentation

```text
specs/014-db-schema/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md

docs/design/database-schema.md
```

### Source Code

```text
backend/
├── src/
│   ├── db.ts
│   └── db/migrations/
│       └── 0001_initial_schema.sql
├── scripts/
│   ├── migrate.mjs
│   ├── test-migrations.mjs
│   └── lib/migrator.mjs
└── package.json

docker-compose.yml
```

**Structure Decision**: 業務repositoryは各機能Issueで`backend/src/db/<resource>.ts`へ追加する。本IssueはSQL source of truthと、アプリruntimeから分離したmigration scriptだけを追加する。

## Complexity Tracking

Constitution違反はない。
