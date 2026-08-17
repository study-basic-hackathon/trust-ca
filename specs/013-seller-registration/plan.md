# Implementation Plan: 販売者登録フロー実装

**Branch**: `feat/13-seller-registration` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

## Summary

`poc/ekyc/`で検証済みの表示名登録〜Didit eKYC本人確認〜webhook/pollingによる状態確認〜運営者による審査中(in_review)確定までのフローを、`backend/`(Hono/PostgreSQL)へ移植し、`frontend/`(Next.js)へ業務ロジックを持たない薄いUIとして追加する。DBスキーマはIssue #14で作成済みの`users`/`seller_profiles`/`seller_verifications`/`verification_events`/`webhook_events`をそのまま使い、新規migrationは行わない前提とする。

## Technical Context

**Language/Version**: TypeScript 5 / Node.js 24(backend, Hono、Cloud Run)、Next.js 16.2.12 / React(frontend, App Router、Firebase App Hosting)

**Primary Dependencies**: backend既存の`hono`・`pg`のみ(新規パッケージ追加なし)。Didit呼び出しはNode.js標準`fetch`、Webhook署名検証はNode.js標準`crypto`(HMAC-SHA256 + `timingSafeEqual`)を使う。frontendも既存構成のまま追加ライブラリなし。

**Storage**: 既存PostgreSQL(`backend/src/db/migrations/0001_initial_schema.sql`の`users`/`seller_profiles`/`seller_verifications`/`verification_events`/`webhook_events`)。新規migrationは不要見込み(research.md #3で確認)。

**Testing**: Vitest。`tests/<resource>.test.ts`で`app.request()`を叩き、`vi.mock("../src/db.js", ...)`でDBをモックする既存パターン(`tests/health.test.ts`)を踏襲。DB制約を伴う検証は`TEST_DATABASE_URL`を使う統合テストで別途確認する。

**Target Platform**: Cloud Run(backend)、Docker Compose(local)、Firebase App Hosting(frontend)

**Project Type**: Web application(frontend + backend、既存構成に追加)

**Performance Goals**: spec.mdのSC-001(表示名送信から本人確認セッションURL取得まで60秒以内)・SC-002(有効な通知受信から状態表示反映まで数秒以内)を満たす。追加の高負荷要件はない(ハッカソンMVP規模)。

**Constraints**: 本人確認PIIを保存しない(FR-012)。外部秘密情報(Didit APIキー・Webhook署名鍵)はbackendのみで扱う(FR-013)。未知・未対応ステータスは`in_review`にフェイルセーフする(FR-009)。既存DBスキーマを変更しない。運営者認可は本番相当のRBACではなく共有シークレット程度で足りる(spec.md Assumptions)。

**Scale/Scope**: 新規APIエンドポイント6本(販売者作成・取得、KYCセッション作成、verification取得、Webhook受信、運営者向け一覧+決定)、frontend新規画面4つ。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design — 変更なし、以下は設計確定後の判定。*

| Principle | 判定 | 対応 |
|---|---|---|
| I. FE/BE責務分離 | PASS | 表示名検証・Didit呼び出し・署名検証・状態正規化・運営者決定はすべて`backend/`のroutes/servicesに置く。frontendはfetchで結果を表示するだけで、Server Actions・Next.js API Routesは追加しない |
| II. フォルダ構成規約 | PASS | `backend/src/routes/{sellers,kyc,webhooks,admin-verifications}.ts`、`backend/src/services/didit/{client,normalize,signature}.ts`、`backend/src/db/{sellers,verifications}.ts`という既存の3層構成に従う。folder-structure.md §2.2が移植元として明示する`poc/ekyc/src/lib/didit/*`をそのまま踏襲する |
| III. poc/ekyc/は参照専用 | PASS | `poc/ekyc/`は読み取り参照のみで変更しない。ロジックは`backend/`へコピー・移植する |
| IV. eKYC信頼設計の原則 | PASS | サーバー間通信(Didit decision API)の結果のみを信用しcallback遷移は使わない(FR-014のU S3-6)。PII非保存(FR-012)。未知ステータスは`in_review`へフェイルセーフ(FR-009)。承認は「出品可能」の判定にのみ使い、`seller_limits`等の段階的制限は別Issueのまま変更しない |
| V. データ層の一元管理 | PASS | 新規`db/sellers.ts`・`db/verifications.ts`は`backend/src/db.ts`が公開する`pool`を引数で受け取るだけで、独自に`pg.Pool`を作らない |

## Project Structure

### Documentation (this feature)

```text
specs/013-seller-registration/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
└── tasks.md              # Phase 2 output (/speckit-tasks で作成)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── app.ts                          # createSellerRoute/createKycRoute/createWebhookRoute/createAdminVerificationRoute を登録
│   ├── env.ts                          # getDiditConfig() を追加(DIDIT_API_KEY / DIDIT_WORKFLOW_ID / DIDIT_WEBHOOK_SECRET_KEY / ADMIN_API_TOKEN)
│   ├── routes/
│   │   ├── sellers.ts                  # POST /api/v1/sellers, GET /api/v1/sellers/{sellerId}
│   │   ├── kyc.ts                      # POST /api/v1/sellers/{sellerId}/kyc-sessions, GET /api/v1/sellers/{sellerId}/verification
│   │   ├── webhooks.ts                 # POST /api/v1/webhooks/didit
│   │   └── admin-verifications.ts      # GET /api/v1/admin/verifications, POST /api/v1/admin/verifications/{sessionId}/decision
│   ├── services/
│   │   ├── sellers.ts                  # 表示名バリデーション、公開情報の整形
│   │   ├── verifications.ts            # セッション開始オーケストレーション、webhook/poll共通の状態適用、運営者決定の適用
│   │   └── didit/
│   │       ├── client.ts               # createVerificationSession, getSessionDecision, DiditApiError(poc/ekyc/src/lib/didit/client.tsを移植)
│   │       ├── normalize.ts            # KycStatus, CheckResult, mapDiditStatus, extractChecks, normalizeDecision, isSellingAllowed(poc同上を移植)
│   │       └── signature.ts            # verifyWebhookSignature(V2→Simple→raw、±300秒)(poc同上を移植)
│   └── db/
│       ├── sellers.ts                  # createSeller, getSellerById, getPublicSellerById
│       └── verifications.ts            # createVerification, updateVerificationFromProvider, applyOperatorDecision, getLatestForSeller, listInReview, recordWebhookEvent
└── tests/
    ├── sellers.test.ts
    ├── kyc.test.ts
    ├── webhooks-didit.test.ts
    └── admin-verifications.test.ts

frontend/
└── src/app/
    ├── sellers/
    │   ├── register/page.tsx           # 表示名登録フォーム
    │   ├── [sellerId]/page.tsx         # 本人確認開始ボタン・状態表示・ポーリング
    │   └── callback/page.tsx           # Diditからの遷移先。ブラウザの遷移結果は信用せず状態再取得だけを行う
    └── admin/
        └── verifications/page.tsx      # 審査中一覧・承認/却下フォーム(Bearer tokenを入力させる簡易UI)

docs/design/api-catalog.md               # §6.2/§6.3の状態列を実装完了に更新(実装完了後)
```

**Structure Decision**: 既存の`backend/src/{routes,services,db}/`3層構成と`app.ts`集約登録パターン(`payments`/`onchain-anchors`/`wallet-auth`と同型)にそのまま従う。`poc/ekyc/src/lib/didit/*`はフレームワーク非依存なため`backend/src/services/didit/`へほぼそのまま移植し、`poc/ekyc/src/lib/db.ts`のクエリ相当は`backend/src/db/{sellers,verifications}.ts`へ、SQLiteからPostgreSQLへの差分(UUID主キー・`jsonb`化等)を反映して移植する(database-schema.md §11参照)。frontendは新規`src/app/sellers/`・`src/app/admin/`配下にNext.js App Routerの規約通りページを追加する。

## Complexity Tracking

Constitution違反はない。
