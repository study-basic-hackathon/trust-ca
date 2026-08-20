# Tasks: プロダクト完成

**Input**: spec.md(受入基準)/ 実装順は依存関係順。各タスク完了時に本ファイルの状態を更新する。

凡例: [ ] 未着手 / [x] 完了 / [~] 進行中

## Phase 1: 設計ドキュメント

- [x] T001 docs/design/screen-design.md — 全画面設計(サイトマップ、各画面のレイアウト・状態・遷移、共通コンポーネント、デザイントークン、文言方針)
- [x] T002 docs/design/shipping-flow.md — 発送・完了フロー設計(状態機械、shipments/order_shipping_addresses、PII境界、API契約)
- [x] T003 docs/design/database-schema.md へ 0004 の追記、api-catalog.md へ listings/orders/shipments 実装状態の反映、CLAUDE.md / README.md の古い記述修正

## Phase 2: フロントエンド基盤(Block A-前半)

- [x] T010 Tailwind CSS v4 + shadcn/ui 導入、デザイントークン(安心・安全のライトテーマ)、共通レイアウト(ヘッダー/フッター/ナビ)
- [x] T011 認証プロバイダ統合: Web3Auth Modal(Google/Discord/X)+ wagmi injected の二重入口 → 既存 /api/v1/wallet-auth/* で SIWE → session。zustand + React Query。セッション状態のヘッダー表示・ガード
- [x] T012 ランディングページ(事前審査型の訴求)・利用規約・プライバシーポリシー画面

## Phase 3: 認証×身元統合(Block B-後半)

- [x] T020 backend: セッション認可ミドルウェア整備(wallet session → user解決)。POST /api/v1/sellers を認証必須にし users↔seller_profiles 紐付け(既存暫定認可の置換)。GET /api/v1/me(自分のuser/seller/wallet/eKYC状態)
- [x] T021 frontend: マイページ(販売者登録→eKYC開始→状態表示。poc/ekyc のステッパー/タイムラインの意匠を移植)
- [x] T022 テスト: me/sellers 認可、wallet二重紐付け拒否

## Phase 4: 出品フロー(Block C)

- [x] T030 backend: db/listings.ts + services/listings.ts + routes/listings.ts(POST/GET一覧/GET詳細/PATCH/close。eKYC承認・seller_limits・Cert重複・PSA/Vision状態の強制。価格はprice_minor)
- [x] T031 backend: cards 作成をウィザードに統合(既存 card-images / psa-verifications / card-image-analyses と接続)
- [ ] T032 frontend: 出品ウィザード(4step: カード情報→画像→検証(PSA/Vision分岐)→確認)
- [ ] T033 frontend: 商品一覧(検索/フィルタ)・商品詳細(信頼シグナル個別表示)
- [ ] T034 テスト: listings service/route(承認なし拒否・limits超過・Cert重複409・状態遷移)

## Phase 5: 購入フロー(Block D)

- [ ] T040 backend: db/orders.ts + services/orders.ts + routes/orders.ts(POST=listing reserve+価格snapshot、GET詳細、GET一覧(buyer/seller)。自己購入拒否)
- [ ] T041 backend: 注文・決済確定イベントの監査組込み(payment confirm transaction へ audit_events + onchain_outbox 追加。anchor tx を注文詳細APIで返却)
- [ ] T042 frontend: 購入確認→注文作成→JPYC決済(既存 /payments/demo のロジックを本フローへ改組)→決済状態表示
- [ ] T043 テスト: orders(reserve競合409・snapshot・自己購入拒否)、監査イベント生成

## Phase 6: 発送・完了フロー(Block E)

- [ ] T050 backend: migration 0004(orders状態追加、shipments、order_shipping_addresses+retention_until)
- [ ] T051 backend: db/shipments.ts + services/shipments.ts + routes(発送登録、受領確認、追跡状態取得。配送先はorder作成時に登録、当事者+運営者のみ参照可)
- [ ] T052 frontend: 配送先入力(注文時)、発送登録画面(販売者)、物流追跡画面(タイムライン)、取引完了画面(丁寧に: サマリ+信頼シグナル+監査リンク)
- [ ] T053 テスト: 状態遷移(不正遷移409)、PII参照認可、migrationテスト更新

## Phase 7: 管理コンソール(Block F)

- [ ] T060 backend: GET /api/v1/admin/listings(+close)、GET /api/v1/admin/orders
- [ ] T061 frontend: /admin ダッシュボード統合(eKYC審査・画像解析・出品管理・取引一覧)
- [ ] T062 テスト: admin認可・強制close

## Phase 8: 品質・受入・デプロイ準備(Block G)

- [ ] T070 E2E: 出品→購入→決済→発送→完了(test-payment-e2e 拡張または新スクリプト)
- [ ] T071 全パッケージ lint/typecheck/test/build green、日本語のみ検査(中国語文字の混入チェック)
- [ ] T072 docs/deploy/gcp-deployment.md(Cloud Run×2(API/worker)、Cloud SQL、Firebase App Hosting、Secret Manager、env一覧、手順)
- [ ] T073 受入チェックリスト(spec.md §3)の自己検証と結果記録
- [ ] T074 PR作成(main向け)
