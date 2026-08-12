# Tasks: PSA証明書照会MVP

## Phase 1: PSA調査・契約

- [x] T001 PSA公式DocumentationとSwaggerからendpoint、認証、モデル、エラーを確認する
- [x] T002 Trustcaの正規化状態とAPI契約を定義する

## Phase 2: Backend Foundation

- [x] T003 `backend/src/env.ts`へPSA環境変数を集約する
- [x] T004 `backend/src/middleware/rate-limit.ts`へMVP用簡易制限を実装する
- [x] T005 `backend/src/services/psa.ts`へクライアント、正規化、再試行、キャッシュを実装する

## Phase 3: User Story 1 - 登録情報照会 (P1)

- [x] T006 [US1] `backend/src/routes/psa-verifications.ts`へ照会APIを実装する
- [x] T007 [US1] `frontend/src/app/psa-verification-form.tsx`へ直接fetchフォームを実装する
- [x] T008 [US1] `frontend/src/app/page.tsx`とCSSへ日語の結果画面を実装する

## Phase 4: User Story 2 - フェイルクローズ (P2)

- [x] T009 [US2] DNAのみ、番号不一致、未知構造を`in_review`にする
- [x] T010 [US2] 秘密情報を含まない400/429/503エラーへ変換する
- [x] T011 [US2] 真正性非保証の注意をUIと設計書へ明記する

## Phase 5: User Story 3 - 利用量制御 (P3)

- [x] T012 [US3] 24時間キャッシュと同時要求集約を実装する
- [x] T013 [US3] 送信元ごとの分間レート制限を実装する

## Phase 6: Validation & Documentation

- [x] T014 `backend/tests/psa-service.test.ts`へ正規化・上流通信テストを追加する
- [x] T015 `backend/tests/psa-route.test.ts`へ契約・エラーテストを追加する
- [x] T016 環境変数、Compose、README、設計書、Quickstartを更新する
- [x] T017 frontend/backendの全静的検査とビルドを再実行する
- [x] T018 モックPSA上流を使い、frontend公開URL・CORS・backend・PostgreSQLを通すE2E疎通を確認する
- [ ] T019 デスクトップ/モバイルのブラウザ表示を視覚確認する(実行環境にブラウザ接続がないためPRレビュー時に確認)
