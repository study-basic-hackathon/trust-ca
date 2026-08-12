# Implementation Plan: 取引情報の非同期オンチェーン記録

**Branch**: `feat/17-async-blockchain` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

## Summary

Issue #14の`audit_events` / `onchain_outbox`を利用し、内部API、PostgreSQL repository、再起動可能worker、viem client、最小Solidity contract、Docker Compose E2Eを追加する。Node-StayのEVM設定検証とreceipt確認を移行し、browser queueはtransactional outboxへ置き換える。

## Technical Context

**Language/Version**: TypeScript 5 / Node.js 24、Solidity 0.8.28、PostgreSQL 16

**Primary Dependencies**: Hono、pg、viem、Hardhat 3

**Storage**: Cloud SQL for PostgreSQL / local PostgreSQL、EVM compatible chain

**Testing**: Vitest、Hardhat Node test runner、実PostgreSQL一時schema、Docker Compose E2E

**Target Platform**: Cloud Run backend/worker、Cloud SQL、Polygon候補、local Hardhat

**Constraints**: PIIをchainへ保存しない、Issue #14 schemaへ依存、MVP APIは内部専用、operator transactionを直列送信

## Constitution Check

| Principle | 判定 | 対応 |
|---|---|---|
| I. FE/BE責務分離 | PASS | frontendへ業務ロジックを追加せずbackend workerで処理 |
| II. フォルダ構成 | PASS | route/service/db/blockchain clientを責務別に配置 |
| III. PoC参照専用 | PASS | `poc/ekyc/`は変更しない |
| IV. 信頼設計 | PASS | chain保存をhashだけに限定し、raw dataとPIIを除外 |
| V. DB整合性 | PASS | transactional outboxとDB制約を利用 |

## Project Structure

```text
backend/
├── src/blockchain/audit-anchor.ts
├── src/db/onchain-outbox.ts
├── src/routes/onchain-anchors.ts
├── src/services/{canonical-json,onchain-worker}.ts
├── src/workers/onchain-anchor.ts
├── scripts/{test-onchain-outbox.ts,test-onchain-e2e.mjs}
└── tests/

blockchain/
├── contracts/TrustcaAuditAnchor.sol
├── scripts/deploy-audit-anchor.ts
├── test/TrustcaAuditAnchor.ts
└── hardhat.config.ts

docs/design/async-onchain-write.md
specs/017-async-blockchain/
```

## Dependency

本branchは`feat/14-db-schema`（PR #27）を取り込み済み。PR #27をmainへ先にmergeし、その後に本PRを更新してmergeする。

## Complexity Tracking

MVP workerは単一operator nonce競合を避けるためbatchを直列処理する。本番でthroughputが必要になった時点でoperator分割またはnonce managerを別Issueで設計する。
