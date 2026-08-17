# Implementation Plan: PSA証明書照会MVP

**Branch**: `feat/15-psa-mvp` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

## Summary

Hono backendにPSA Public APIクライアントとTrustca向け正規化APIを追加し、Next.jsのクライアントコンポーネントから直接利用する。安全側の結果判定、タイムアウト、1回再試行、メモリキャッシュ、同時要求集約、簡易レート制限を含む。

## Technical Context

**Language/Version**: TypeScript 5、Node.js 24、React 19

**Primary Dependencies**: Hono 4、Next.js 16.2.12、Node標準`fetch`

**Storage**: MVPはプロセスメモリ。Cloud SQL永続化はIssue #14取り込み後

**Testing**: Vitest、ESLint、TypeScript、Next.js production build、ブラウザE2E

**Target Platform**: Cloud Run backend、Firebase App Hosting frontend

**Project Type**: frontend/backend分離Webアプリ

**Performance Goals**: 5秒で上流タイムアウト、同一番号の重複外部呼び出しを抑制

**Constraints**: PSAトークンをfrontendへ公開しない。未知状態を承認しない

**Scale/Scope**: 1照会画面、1 backend endpoint、PSA単一endpoint

## Constitution Check

- [x] 業務ロジックはbackendに限定。frontendは表示と直接fetchだけ。
- [x] `routes/`、`services/`、画面コロケーションの配置規約に準拠。
- [x] `poc/ekyc/`は変更しない。
- [x] サーバー間のPSA結果だけを信用し、未知状態は`in_review`にする。
- [x] DB Poolを追加生成しない。本MVPはDBへ依存しない。

設計後の再確認でも違反なし。

## Project Structure

```text
backend/src/
├── env.ts
├── middleware/rate-limit.ts
├── routes/psa-verifications.ts
└── services/psa.ts
backend/tests/
├── psa-route.test.ts
└── psa-service.test.ts

frontend/src/app/
├── globals.css
├── page.module.css
├── page.tsx
└── psa-verification-form.tsx

docs/design/psa-api-mvp.md
specs/015-psa-mvp/
```

**Structure Decision**: 既存のfrontend/backend分離を維持し、単一画面専用コンポーネントは`app/`へコロケーションする。外部API設定は規約どおり`backend/src/env.ts`へ集約する。

## Complexity Tracking

憲章違反はないため記載なし。
