# Tasks: 販売者登録フロー実装

## Phase 1: Specification

- [x] T001 `specs/013-seller-registration/spec.md`へuser storyと受入条件を定義する
- [x] T002 `specs/013-seller-registration/research.md`へ技術判断を記録する
- [x] T003 `specs/013-seller-registration/data-model.md`へentityとtransaction境界を定義する
- [x] T004 `specs/013-seller-registration/plan.md`でConstitution Checkを完了する

## Phase 2: DB repository層

- [ ] T005 `backend/src/db/sellers.ts`へ`createSeller`/`getSellerById`/`getPublicSellerById`を実装する
- [ ] T006 `backend/src/db/verifications.ts`へ`createSession`/`getActiveForSeller`/`getBySessionId`を実装する
- [ ] T007 同ファイルへ`applyProviderDecision`(期待するstatus付きUPDATE + `verification_events`追記 + 承認確定時の`seller_profiles.onboarding_status`同期を1 transaction)を実装する
- [ ] T008 同ファイルへ`recordOperatorDecision`(`in_review`限定UPDATE + `source='operator'`のevent追記)と`listInReview`を実装する
- [ ] T009 同ファイルへ`recordWebhookEvent`(`provider_event_id`/`payload_sha256`の重複排除insert)を実装する

## Phase 3: Didit連携・service層

- [ ] T010 `poc/ekyc/src/lib/didit/client.ts`を`backend/src/services/didit/client.ts`へ移植する(`createVerificationSession`/`getSessionDecision`/`DiditApiError`)
- [ ] T011 `poc/ekyc/src/lib/didit/normalize.ts`を`backend/src/services/didit/normalize.ts`へ移植する(`mapDiditStatus`/`extractChecks`/`normalizeDecision`/`isSellingAllowed`)
- [ ] T012 `poc/ekyc/src/lib/didit/signature.ts`を`backend/src/services/didit/signature.ts`へ移植する(V2→Simple→raw、タイムスタンプ±300秒許容)
- [ ] T013 `backend/src/env.ts`へ`getDiditConfig()`(`DIDIT_MVP_ENABLED`/`DIDIT_API_KEY`/`DIDIT_WORKFLOW_ID`/`DIDIT_WEBHOOK_SECRET_KEY`)と`getAdminConfig()`(`ADMIN_API_TOKEN`)を追加する
- [ ] T014 `backend/src/services/verifications.ts`へセッション開始オーケストレーション(進行中セッションがあれば再利用する冪等処理)と、webhook/poll共通の状態適用ロジックを実装する
- [ ] T015 `backend/src/services/sellers.ts`へ表示名バリデーション(1〜100文字)と公開情報の整形を実装する

## Phase 4: Backend APIルート層

- [ ] T016 `backend/src/routes/sellers.ts`へ`POST /api/v1/sellers`・`GET /api/v1/sellers/{sellerId}`を実装する
- [ ] T017 `backend/src/routes/kyc.ts`へ`POST /api/v1/sellers/{sellerId}/kyc-sessions`(Authorizationヘッダーがあればwallet sessionと突合する任意検証込み)・`GET /api/v1/sellers/{sellerId}/verification`(`refresh=1`でDiditへpoll)を実装する
- [ ] T018 `backend/src/routes/webhooks.ts`へ`POST /api/v1/webhooks/didit`(署名検証→`webhook_events`重複排除→状態適用)を実装する
- [ ] T019 `backend/src/routes/admin-verifications.ts`へ`GET /api/v1/admin/verifications`・`POST /api/v1/admin/verifications/{sessionId}/decision`(`Authorization: Bearer ADMIN_API_TOKEN`検証)を実装する
- [ ] T020 `backend/src/app.ts`へ4ルートを`createXxxRoute({pool, config})`パターンで登録する
- [ ] T021 `backend/.env.example`と`docker-compose.yml`へ`DIDIT_*`・`ADMIN_API_TOKEN`を追加する

## Phase 5: Frontend

- [ ] T022 `frontend/src/app/sellers/register/page.tsx`へ表示名登録フォームを実装する
- [ ] T023 `frontend/src/app/sellers/[sellerId]/page.tsx`へ本人確認開始ボタン・状態表示・5秒間隔ポーリングを実装する
- [ ] T024 `frontend/src/app/sellers/callback/page.tsx`へcallback遷移(状態再取得のトリガーとしてのみ扱い、遷移結果自体は表示に使わない)を実装する
- [ ] T025 `frontend/src/app/admin/verifications/page.tsx`へ審査中一覧・承認/却下フォーム(Bearer token入力欄)を実装する

## Phase 6: Verification

- [ ] T026 `backend/tests/sellers.test.ts`・`backend/tests/kyc.test.ts`へ正常系・バリデーションエラー・進行中セッション重複防止のunit testを実装する
- [ ] T027 `backend/tests/webhooks-didit.test.ts`へ署名有効/無効/再送/未知ステータスのunit testを実装する
- [ ] T028 `backend/tests/admin-verifications.test.ts`へ権限エラー・`in_review`限定・確定済み上書き拒否のunit testを実装する
- [ ] T029 `TEST_DATABASE_URL`を使う統合テストで、進行中セッション1件制限・`operator` sourceのDB制約を検証する
- [ ] T030 backendの`pnpm lint`/`pnpm typecheck`/`pnpm test`/`pnpm build`とfrontendの`pnpm lint`/`pnpm build`を実行する
- [ ] T031 Docker Composeで起動順を確認し、`specs/013-seller-registration/quickstart.md`のスモークテスト手順(登録→セッション作成→webhook→運営者確定)を通す

## Phase 7: Documentation

- [ ] T032 `docs/design/api-catalog.md` §6.2/§6.3の該当行(状態列)を実装済みへ更新する
- [ ] T033 `specs/013-seller-registration/quickstart.md`の手順を実装結果に合わせて最終確認する
