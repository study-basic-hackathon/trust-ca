# Tasks: PostgreSQLスキーマ基盤

## Phase 1: Specification

- [x] T001 `specs/014-db-schema/spec.md`へuser storyと受入条件を定義する
- [x] T002 `specs/014-db-schema/research.md`へ技術判断を記録する
- [x] T003 `specs/014-db-schema/data-model.md`へentityとtransaction境界を定義する
- [x] T004 `specs/014-db-schema/plan.md`でConstitution Checkを完了する

## Phase 2: Migration foundation

- [x] T005 `backend/scripts/lib/migrator.mjs`へtransaction、lock、checksum付きrunnerを実装する
- [x] T006 `backend/scripts/migrate.mjs`へCLIを実装する
- [x] T007 `backend/package.json`へmigration commandを追加する
- [x] T008 `docker-compose.yml`へone-shot migration serviceを追加する

## Phase 3: Initial schema

- [x] T009 `backend/src/db/migrations/0001_initial_schema.sql`へaccount/eKYC tableを作成する
- [x] T010 同migrationへcard/listing/order/payment tableを作成する
- [x] T011 同migrationへaudit event/onchain outbox tableを作成する
- [x] T012 mutable tableへ`updated_at` triggerを設定する
- [x] T013 検索・重複防止用indexを設定する

## Phase 4: Verification

- [x] T014 `backend/scripts/test-migrations.mjs`へ一時schema統合テストを実装する
- [x] T015 migrationの初回/再実行/checksum/主要constraintを検証する
- [x] T016 backendのlint/typecheck/test/buildを実行する
- [x] T017 Docker Composeでmigration → backend起動順を検証する

## Phase 5: Documentation

- [x] T018 `docs/design/database-schema.md`へER図、table一覧、運用方針を作成する
- [x] T019 `backend/README.md`と`docs/design/folder-structure.md`へmigration手順を追記する
- [x] T020 `README.md`からDB設計書へリンクする
- [x] T021 `specs/014-db-schema/quickstart.md`の手順を最終確認する
