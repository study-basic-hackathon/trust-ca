# Tasks: Vision APIによるカード画像コンテンツチェックMVP

**Input**: Design documents from `/specs/019-vision-card-authenticity/`

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、quickstart.md

**Tests**: このリポジトリの既存コード(`backend/tests/psa-route.test.ts`等)は各routes/servicesに対応する`*.test.ts`を常設しており、CLAUDE.mdの検証コマンドも`pnpm test`を前提としているため、本タスクにはテストタスクを含める。

**Organization**: タスクはspec.mdのUser Story(P1/P2/P3)ごとにグループ化する。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並行実行可能(別ファイル・依存なし)
- **[Story]**: 対応するUser Story(US1/US2/US3)
- 各タスクに実ファイルパスを明記する

## Path Conventions

plan.mdの構成に従い、`backend/src/`・`backend/tests/`・`frontend/src/app/`を使う(web app構成)。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 依存関係・環境変数の追加

- [X] T001 `google-auth-library`・`@google-cloud/storage`を`backend/package.json`の`dependencies`へ追加し`pnpm install`する
- [X] T002 [P] `VISION_MVP_ENABLED`・`VISION_STORAGE_BUCKET`・`VISION_API_TIMEOUT_MS`・`VISION_CACHE_TTL_SECONDS`等を`backend/.env.example`へ追記する(PSA_MVP_ENABLED等の既存記法に倣う)
- [X] T003 [P] `backend/src/env.ts`へ`VisionConfig`型と`getVisionConfig()`を追加する(`getPsaConfig()`と同じ構造)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: US1/US2/US3のすべてが依存する共通基盤

**⚠️ CRITICAL**: このフェーズが完了するまでUser Story着手不可

- [X] T004 `backend/src/db/card-images.ts`に`insertCardImage`・`getCardImageById`・`listCardImagesByCard`をPoolベースで実装する(既存`db/payments.ts`の関数群パターンを踏襲。data-model.md「既存テーブル」節参照)
- [X] T005 [P] `backend/src/services/storage.ts`に、非公開GCSバケットへのV4署名付きPUT URL発行(`issueUploadUrl`)と、アップロード完了後のobject存在・content-type・byte size検証(`verifyUploadedObject`)を`@google-cloud/storage`で実装する(research.md §4)

**Checkpoint**: 基盤完了。User Story 1から着手可能

---

## Phase 3: User Story 1 - 出品者が四隅画像を登録する (Priority: P1) 🎯 MVP

**Goal**: PSA証明書番号を持たない出品者が、出品時にカードの四隅等の画像をアップロードし、Cloud Storage + `card_images`に保存される。

**Independent Test**: 出品フローで画像をアップロードし、`card_images`にobject key・content type・byte size・SHA-256・撮影種別が記録されることを確認する(spec.md User Story 1 Independent Test)。

### Tests for User Story 1

- [X] T006 [P] [US1] `backend/tests/card-image-uploads-route.test.ts`に署名付きURL発行APIの契約テスト(未認証拒否、content-type不正拒否)を書く
- [X] T007 [P] [US1] `backend/tests/card-images-route.test.ts`にアップロード完了登録APIの契約テスト(所有者以外の出品時アップロード拒否、非画像形式・サイズ超過の拒否 = FR-001 Acceptance Scenario 2)を書く

### Implementation for User Story 1

- [X] T008 [US1] `backend/src/routes/card-image-uploads.ts`に`POST /api/v1/uploads/card-images`(`sessionFromAuthorization`で認証、`services/storage.ts#issueUploadUrl`を呼び出し)を実装し、`backend/src/app.ts`へ登録する(T005に依存)
- [X] T009 [US1] `backend/src/routes/card-images.ts`に`POST /api/v1/cards/{cardId}/images`(`imageKind`・`contentType`(`image/jpeg`|`image/png`|`image/webp`)・`byteSize`・`sha256`をバリデーションし、`services/storage.ts#verifyUploadedObject`で実体を検証したうえで`db/card-images.ts#insertCardImage`へ保存。出品時アップロードは`uploaded_by_user_id === cards.current_owner_id`を要求)を実装し、`backend/src/app.ts`へ登録する(T004, T005, T008に依存)
- [X] T010 [P] [US1] `frontend/src/app/cards/[cardId]/images/seller-upload-form.tsx`にクライアントコンポーネントとして、署名付きURL発行→PUT→登録の3ステップをbackendへ直接fetchする出品時アップロードUIを実装する(Server Actions・API Routesを使わない)
- [X] T011 [US1] `frontend/src/app/cards/[cardId]/images/page.tsx`に画面を新設し、T010のフォームを配置する(T010に依存)

**Checkpoint**: User Story 1が単独で完結・テスト可能

---

## Phase 4: User Story 2 - 購入者が到着後に画像をアップロードし内容整合性チェックを受け取る (Priority: P2)

**Goal**: 購入者が到着後に同一箇所を再撮影してアップロードすると、Vision APIのOCR・ラベル・領域検出結果と出品時申告内容(`cards.name`/`card_number`)を突合し、`内容整合`/`要確認`を返す。

**Independent Test**: 出品時に申告されたカード名・型番と、到着後画像のOCR結果を突合し、`内容整合`または`要確認`に正規化されて画面に表示されることを確認する(spec.md User Story 2 Independent Test)。

### Tests for User Story 2

- [X] T012 [P] [US2] `backend/tests/vision-service.test.ts`にVision API呼び出しのタイムアウト・1回再試行・5xx/429分類・認証エラー分類のテストを書く(`services/psa.ts`のテスト方針を踏襲)
- [X] T013 [P] [US2] `backend/tests/card-image-analysis-service.test.ts`にOCR突合ロジックの単体テストを書き、data-model.md「判定ロジックとstatusの対応」表の全パターン(`completed`/`in_review`×名前不一致/番号不一致/ラベル未検出、`failed`)を網羅する
- [X] T014 [P] [US2] `backend/tests/card-image-analyses-route.test.ts`に解析実行APIの契約テスト(存在しない`imageId`、他カードの画像を指定した場合の拒否)を書く

### Implementation for User Story 2

- [X] T015 [US2] `backend/src/services/vision.ts`に`images:annotate`呼び出し(`google-auth-library`でADCトークン取得、`TEXT_DETECTION`+`OBJECT_LOCALIZATION`+`LABEL_DETECTION`を1リクエストで要求、タイムアウト+最大1回再試行、5xx/429/401/403のエラー分類)を実装する(T003に依存)
- [X] T016 [P] [US2] `backend/src/db/card-image-analyses.ts`に`insertCardImageAnalysis`・`getCardImageAnalysisById`・`listCardImageAnalysesByCard`をPoolベースで実装する(T004と同様のパターン)
- [X] T017 [US2] `backend/src/services/card-image-analysis.ts`に、OCR全文正規化・`cards.name`/`cards.card_number`との部分文字列突合・カード様ラベル判定・data-model.mdの判定表に基づく`status`/`score`/`normalized_result`算出ロジックを実装する(T015に依存)
- [X] T018 [US2] `backend/src/routes/card-image-analyses.ts`に`POST /api/v1/card-image-analyses`(`cardId`+`imageId`を受け取り同期的にVision解析を実行・保存)と`GET /api/v1/card-image-analyses/{analysisId}`を実装し、`backend/src/app.ts`へ登録する(T016, T017に依存)
- [X] T019 [P] [US2] `frontend/src/app/cards/[cardId]/images/buyer-analysis-view.tsx`に、到着後アップロード(T010と同じ3ステップをbackendへ直接fetch)と解析結果(`内容整合`/`要確認`、FR-010の真正性非保証の注意書き)の表示を実装する

**Checkpoint**: User Story 1・2が両方とも単独で機能する

---

## Phase 5: User Story 3 - 運営者が要確認ケースを確認する (Priority: P3)

**Goal**: 運営者が`要確認`となった解析結果を一覧・詳細で確認できる。

**Independent Test**: `内容整合`と`要確認`が混在する解析結果を、運営者向けAPIから欠落なく取得できることを確認する(spec.md User Story 3 Independent Test)。

### Tests for User Story 3

- [X] T020 [P] [US3] `backend/tests/card-image-analyses-admin-route.test.ts`に運営者向け一覧APIの契約テスト(内部トークン未提示時の401、`status=in_review`絞り込み)を書く

### Implementation for User Story 3

- [X] T021 [US3] `backend/src/routes/card-image-analyses.ts`に`GET /api/v1/admin/card-image-analyses?status=in_review`を追加する。認可は`routes/onchain-anchors.ts`の`isAuthorized`/`timingSafeEqual`による内部Bearerトークン方式を再利用し、`cards`・`card_images`・`card_image_analyses`を結合して出品時申告内容・対象画像object key・解析要約を返す(T016, T018に依存)
- [X] T022 [P] [US3] `frontend/src/app/admin/card-image-analyses/page.tsx`に、`要確認`一覧を表示する最小限の運営者向け画面を実装する

**Checkpoint**: User Story 1・2・3すべてが単独で機能する

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T023 `docs/design/api-catalog.md` §6.4の該当行(`POST /uploads/card-images`・`POST /card-image-analyses`・`GET /card-image-analyses/{analysisId}`)の状態を「#16対象」から実装済みへ更新し、新設した運営者向け一覧APIを追記する
- [X] T024 [P] FR-010に対応する真正性非保証・精巧な偽造検出不可の注意書きが、T011・T019双方のUIに表示されていることを確認する
- [X] T025 `backend/`で`pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm build`を実行する
- [X] T026 `frontend/`で`pnpm lint`・`pnpm build`を実行する
- [X] T027 `specs/019-vision-card-authenticity/quickstart.md`の手順に沿って、Docker Compose上でアップロード→解析→運営者一覧のE2E疎通を確認する

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし。即着手可能
- **Foundational (Phase 2)**: Setup完了後。全User Storyをブロックする
- **User Stories (Phase 3+)**: Foundational完了後に着手可能。優先度順(P1→P2→P3)を推奨するが、US1完了後はUS2・US3を並行着手できる
- **Polish (Phase 6)**: 実装対象のUser Story完了後

### User Story Dependencies

- **US1 (P1)**: Foundational完了後、他Storyに依存せず着手可能
- **US2 (P2)**: Foundational完了後に着手可能。ルート実装(T018)は独立だが、実運用上はUS1で保存された出品時画像・`cards`行の存在を前提に検証する
- **US3 (P3)**: T016(`db/card-image-analyses.ts`)完了が前提。US2のPOST実装(T018)と機能的に独立ではないため、US2完了後の着手を推奨

### Within Each User Story

- テスト → DB/サービス層 → route実装 → frontend、の順で依存する
- 同一ファイル(`backend/src/app.ts`)を編集するroute登録タスク同士は並行実行しない

### Parallel Opportunities

- Setup: T002・T003は並行可能
- Foundational: T004・T005は並行可能(別ファイル)
- US1: T006・T007(テスト)は並行可能。T010(frontend)はT008/T009と並行可能
- US2: T012・T013・T014(テスト)は並行可能。T016はT015と並行可能。T019(frontend)はT015〜T018と並行可能
- US3: T022(frontend)はT021と並行可能

---

## Parallel Example: User Story 1

```bash
# US1のテストを並行実行
Task: "backend/tests/card-image-uploads-route.test.ts に契約テストを書く"
Task: "backend/tests/card-images-route.test.ts に契約テストを書く"

# frontend実装はbackend実装と並行可能
Task: "frontend/src/app/cards/[cardId]/images/seller-upload-form.tsx を実装する"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup完了
2. Phase 2: Foundational完了(必須、全Storyをブロック)
3. Phase 3: User Story 1完了
4. **一旦停止して検証**: 出品時アップロード単体で動作することを確認
5. 必要であればここでデモ・レビューへ回す

### Incremental Delivery

1. Setup + Foundational → 基盤完了
2. User Story 1追加 → 単独テスト → デモ(MVP)
3. User Story 2追加 → 単独テスト → デモ(内容整合性チェックの価値が出る)
4. User Story 3追加 → 単独テスト → デモ(運営者確認フローが揃う)

---

## Notes

- `[P]`タスク = 別ファイル・依存なし
- `[Story]`ラベルはUser Storyへのtraceability用
- 各User Storyは独立して完了・テスト可能であること
- 実装前にテストが失敗することを確認する
- タスクごと、または論理的なまとまりごとにcommitする
- 物理的な同一個体照合(`analysis_kind = 'image_comparison'`)は本tasks.mdの対象外(spec.md FR-012、別タスクで扱う)
