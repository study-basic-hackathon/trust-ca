# Tasks: 販売者登録フロー実装

## Phase 1: Specification

- [x] T001 `specs/013-seller-registration/spec.md`へuser storyと受入条件を定義する
- [x] T002 `specs/013-seller-registration/research.md`へ技術判断を記録する
- [x] T003 `specs/013-seller-registration/data-model.md`へentityとtransaction境界を定義する
- [x] T004 `specs/013-seller-registration/plan.md`でConstitution Checkを完了する

## Phase 2: DB repository層

- [x] T005 `backend/src/db/migrations/0003_seller_verification_session_url.sql`へ`seller_verifications.session_url`列を追加する(実装時に判明したギャップ。research.md #3)
- [x] T006 `backend/src/db/sellers.ts`へ`createSeller`/`getSellerById`を実装する
- [x] T007 `backend/src/db/verifications.ts`へ`createSession`/`getActiveForSeller`/`getLatestForSeller`/`getBySessionId`を実装する
- [x] T008 同ファイルへ`applyProviderDecision`(期待するstatus付きUPDATE + `verification_events`追記 + 承認確定時の`seller_profiles.onboarding_status`同期を1 transaction)を実装する
- [x] T009 同ファイルへ`recordOperatorDecision`(`in_review`限定UPDATE + `source='operator'`のevent追記)と`listInReview`を実装する
- [x] T010 同ファイルへ`recordWebhookEvent`(`provider_event_id`/`payload_sha256`の重複排除insert)を実装する

## Phase 3: Didit連携・service層

- [x] T011 `poc/ekyc/src/lib/didit/client.ts`を`backend/src/services/didit/client.ts`へ移植する(`createVerificationSession`/`getSessionDecision`/`DiditApiError`)
- [x] T012 `poc/ekyc/src/lib/didit/normalize.ts`を`backend/src/services/didit/normalize.ts`へ移植する(`mapDiditStatus`/`extractChecks`/`normalizeDecision`/`isSellingAllowed`)
- [x] T013 `poc/ekyc/src/lib/didit/signature.ts`を`backend/src/services/didit/signature.ts`へ移植する(V2→Simple→raw、`created_at`ベースの±300秒許容)
- [x] T014 `backend/src/env.ts`へ`getDiditConfig()`(`DIDIT_MVP_ENABLED`/`DIDIT_API_KEY`/`DIDIT_WORKFLOW_ID`/`DIDIT_WEBHOOK_SECRET_KEY`)と`getAdminConfig()`(`ADMIN_API_TOKEN`)を追加する
- [x] T015 `backend/src/services/verifications.ts`へセッション開始オーケストレーション(進行中セッションがあれば再利用する冪等処理)と、webhook/poll共通の状態適用ロジックを実装する
- [x] T016 `backend/src/services/sellers.ts`へ表示名バリデーション(1〜100文字)を実装する

## Phase 4: Backend APIルート層

- [x] T017 `backend/src/routes/sellers.ts`へ`POST /api/v1/sellers`・`GET /api/v1/sellers/{sellerId}`を実装する
- [x] T018 `backend/src/routes/kyc.ts`へ`POST /api/v1/sellers/{sellerId}/kyc-sessions`(Authorizationヘッダーがあればwallet sessionと突合する任意検証込み)・`GET /api/v1/sellers/{sellerId}/verification`(`refresh=1`でDiditへpoll)を実装する
- [x] T019 `backend/src/routes/webhooks.ts`へ`POST /api/v1/webhooks/didit`(署名検証→`webhook_events`重複排除→状態適用)を実装する
- [x] T020 `backend/src/routes/admin-verifications.ts`へ`GET /api/v1/admin/verifications`・`POST /api/v1/admin/verifications/{sessionId}/decision`(`Authorization: Bearer ADMIN_API_TOKEN`検証)を実装する
- [x] T021 `backend/src/app.ts`へ4ルートを`createXxxRoute({pool, config})`パターンで登録する
- [x] T022 `backend/.env.example`と`docker-compose.yml`へ`DIDIT_*`・`ADMIN_API_TOKEN`を追加する

## Phase 5: Frontend

- [x] T023 `frontend/src/lib/api.ts`へ共通fetchヘルパー(`{data}`/`{error}`envelopeの処理)を実装する
- [x] T024 `frontend/src/app/sellers/register/page.tsx`へ表示名登録フォームを実装する
- [x] T025 `frontend/src/app/sellers/[sellerId]/page.tsx`へ本人確認開始ボタン・状態表示・ポーリングを実装する(TanStack Queryの`refetchInterval`を使用。理由はNote参照)
- [x] T026 `frontend/src/app/sellers/callback/page.tsx`へcallback遷移(状態再取得のトリガーとしてのみ扱い、遷移結果自体は表示に使わない)を実装する
- [x] T027 `frontend/src/app/admin/verifications/page.tsx`へ審査中一覧・承認/却下フォーム(Bearer token入力欄)を実装する

## Phase 6: Verification

- [x] T028 `backend/tests/sellers.test.ts`・`backend/tests/kyc.test.ts`へ正常系・バリデーションエラー・進行中セッション重複防止のunit testを実装する
- [x] T029 `backend/tests/webhooks-didit.test.ts`へ署名有効/無効/再送/未知ステータスのunit testを実装する(`didit-signature.test.ts`/`didit-normalize.test.ts`で純粋ロジックも別途検証)
- [x] T030 `backend/tests/admin-verifications.test.ts`へ権限エラー・`in_review`限定・確定済み上書き拒否のunit testを実装する
- [x] T031 backendの`pnpm lint`/`pnpm typecheck`/`pnpm test`(58 tests)/`pnpm build`とfrontendの`pnpm lint`/`pnpm build`を実行し、すべて成功を確認した
- [x] T032 ローカルのDocker Compose PostgreSQLへ`pnpm db:migrate`を適用し(0001〜0003が新規適用・冪等性を確認)、backendをhost起動してquickstart.mdの手順(登録→verification取得→webhook適用→運営者承認→`seller_profiles.onboarding_status`同期→再確定時409)を実際に通した

## Phase 7: Documentation

- [x] T033 `docs/design/api-catalog.md` §6.2/§6.3の該当行(状態列・認可実装)を実装済みへ更新する
- [x] T034 `specs/013-seller-registration/quickstart.md`の手順を実装結果に合わせて最終確認する

## Note: 実装中に見つかった問題と対応

- **SQLパラメータ型推論の衝突**: `applyProviderDecision`のUPDATE文で同一プレースホルダ(`$2`)を`SET status = $2`と`$2 = ANY($6::varchar[])`の両方で使うと、PostgreSQLが`text` vs `character varying`の型不一致(`42P08`)を報告し500エラーになることを実機テストで発見。`decided_at`を確定するかどうかの判定をJS側で計算済みbooleanとして渡す形に修正し解消した(`backend/src/db/verifications.ts`)。mockしたunit testでは検出できず、実PostgreSQLに対するE2Eスモークテストで見つかった。
- **jsonb列への書き込み**: 既存コード(`db/onchain-outbox.ts`)の慣習(JSON文字列化してから`::jsonb`キャスト)に合わせて`checks`列への書き込みを修正した。
- **eslintの`react-hooks/set-state-in-effect`**: Next.js 16の新しいReact Compiler系lintルールが、effect内で(ローカル定義した関数経由でも)setStateを呼ぶパターンを拒否するため、状態表示ページは既存依存の`@tanstack/react-query`(`useQuery`/`useMutation`)を使う形に変更した。callback頁は状態を持たない形に単純化して回避した。
- **Docker Composeのbackendコンテナ**: ローカルで9日前から起動していた既存の`backend`コンテナが、`pnpm dev`起動時に`corepack`経由のpnpmが依存関係チェックで対話確認を要求し、`no TTY`で失敗して起動できない状態だった(anonymous volumeを作り直しても再現するため、本Issueの変更が原因ではなく既存の環境問題)。host側で`pnpm dev`を直接起動して動作確認したため本Issueの実装検証は完了しているが、コンテナ起動の問題自体は別途対応が必要。
