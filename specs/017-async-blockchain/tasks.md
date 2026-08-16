# Tasks: 取引情報の非同期オンチェーン記録

## Phase 1: Specification / migration analysis

- [x] T001 Node-Stayのprovider、receipt、cursor、browser outbox実装を調査する
- [x] T002 Trustcaへの移行判断とfailure windowを定義する
- [x] T003 Issue #14のaudit/outbox schemaをdependencyとして取り込む
- [x] T004 spec、research、data model、planを作成する

## Phase 2: Contract

- [x] T005 Hardhat 3 packageとlocal networkを構成する
- [x] T006 `TrustcaAuditAnchor`を実装する
- [x] T007 deploy scriptとDocker imageを追加する
- [x] T008 初回、冪等再送、hash競合、権限、operator変更の5 testを実装する

## Phase 3: Backend / worker

- [x] T009 canonical JSONとSHA-256を実装する
- [x] T010 viem clientと起動時設定検証を実装する
- [x] T011 transactional registrationとstatus取得repositoryを実装する
- [x] T012 `SKIP LOCKED` claim、tx保存、確定、retry/dead更新を実装する
- [x] T013 内部POST / GET APIとBearer認証を実装する
- [x] T014 restart可能なpolling workerを実装する

## Phase 4: Verification

- [x] T015 canonical、route、worker unit testを実装する
- [x] T016 実PostgreSQLで冪等性と2 worker同時claimを検証する
- [x] T017 Docker Compose blockchain profileを追加する
- [x] T018 HTTP→DB→worker→contract→receipt E2Eを実装・実行する
- [x] T019 backend lint/typecheck/test/buildとcontract build/testを実行する

## Phase 5: Documentation

- [x] T020 非同期オンチェーン記録設計書とMermaid図を作成する
- [x] T021 README、folder structure、environment設定例を更新する
- [x] T022 local quickstartと本番Cloud Tasks移行案を記録する
