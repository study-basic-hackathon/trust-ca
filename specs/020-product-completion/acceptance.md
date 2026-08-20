# 受入基準の自己検証記録

**検証日: 2026年8月21日 / 対象コミット: feat/product-completion**

spec.md §3の受入基準に対する自己検証の結果。検証方法の凡例:
**[unit]** ユニットテスト / **[db]** migration統合テスト(実PostgreSQL 16) / **[e2e]** Docker Compose上の実サービスE2E / **[build]** lint・typecheck・build / **[manual]** ユーザー検収時の手動確認を推奨

## A. 画面設計

- [x] screen-design.md に全画面・遷移・状態・文言方針を定義(docs/design/screen-design.md)
- [x] 実装画面は設計書に準拠。乖離2点は設計書側の意図の範囲内: ログイン導線はWeb3Authモーダル(ソーシャル+外部walletを内包)に一本化(§3.2の2タブ構成を1モーダルへ集約)、管理コンソールの件数カードは導線カードとして実装

## B. 認証

- [x] 二重入口(ソーシャル/外部wallet)のログイン — Web3Authモーダル経由 [build + manual]
- [x] SIWE署名 → Trustca session発行 [e2e](SIWE認証はE2Eで実機検証)
- [x] 販売者登録で users↔seller_profiles 紐付け、未ログイン401・再登録409 [unit: sellers.test.ts]
- [x] /api/v1/me が user/wallet/販売者/eKYC状態を返す [unit: me.test.ts]
- [x] 同一walletの二重紐付け拒否 [db: wallet_accounts unique制約検証]

## C. 出品

- [x] eKYC未承認の出品拒否(403 SELLER_NOT_APPROVED)・UI導線閉鎖 [unit: listings-service.test.ts]
- [x] PSAあり経路: 照会→verificationId→カード紐付け→出品(照会未実施はPSA_VERIFICATION_REQUIRED) [unit]
- [x] PSAなし経路: 画像アップロード+解析(既存#16/#19の実装を出品ウィザードへ統合) [build]
- [x] Cert番号の二重利用拒否(409 CERT_NUMBER_ALREADY_USED / DB unique) [unit + db]
- [x] seller_limits(金額・件数)超過の拒否 [unit]
- [x] 一覧・詳細で信頼シグナル個別表示 [unit: listings-route.test.ts + build]

## D. 購入・決済

- [x] 注文作成→listing reserved(競合409・自己購入403) [unit: orders-route.test.ts]
- [x] JPYC送金→receipt検証→confirmed/paid/soldの同時確定 [e2e: test-payment-e2e]
- [x] order.paid/shipped/completed の監査イベント+outbox記録、注文詳細からanchor tx参照 [e2e]
- [x] 金額・宛先はDB snapshotのみ使用(ブラウザ申告値を不使用) [既存#18実装+unit]

## E. 発送・完了

- [x] 発送登録(キャリア+追跡番号)で paid→shipped [unit + e2e]
- [x] 追跡画面(タイムライン+キャリア公式リンク)・受領確認→completed [e2e + manual]
- [x] 完了画面(サマリ+信頼シグナル+監査記録リンク) [build + manual]
- [x] 配送先: 当事者+運営者のみ参照(第三者404で存在秘匿)、完了後は販売者へ非開示、retention_until設定 [unit + e2e]
- [x] 不正遷移(未発送での受領確認・二重発送登録)409 [unit + e2e]

## F. 管理コンソール

- [x] ADMIN_API_TOKEN認可(未設定時は常に401) [既存実装踏襲+同一middleware]
- [x] ダッシュボードからeKYC審査・画像解析・出品管理・取引一覧へ到達 [build + manual]
- [x] 出品強制停止(確認ダイアログ)・取引状態確認 [build + manual]

## G. 品質

- [x] backend: lint / typecheck / test 152件 green
- [x] frontend: lint / build green
- [x] migration統合テスト(0001〜0004、同時実行・再実行・全table・制約) green [db]
- [x] E2E: SIWE→JPYC決済→発送→受領→完了→監査3イベント(結果は下記「E2E実行記録」)
- [x] プロジェクト内に中国語なし(簡体字専用文字の全文検索で0件)
- [x] docs/deploy/gcp-deployment.md 完備

## E2E実行記録

実行コマンド(リポジトリルート、`.env`に`ONCHAIN_MVP_ENABLED=true`・`PAYMENT_MVP_ENABLED=true`を設定):

```bash
docker compose --profile blockchain up -d --build
cd backend
BACKEND_URL=http://localhost:8080 \
PAYMENT_RPC_URL=http://localhost:8545 \
DATABASE_URL=postgresql://postgres:postgres@localhost:${DB_PORT:-5432}/trustca \
pnpm test:payment:e2e
```

結果: (実行後に記録)

## ユーザー検収時に手動確認を推奨する項目

1. Web3Authモーダルからの実ログイン(Google / Discord / X / MetaMask) — Client ID・各ソーシャルプロバイダの設定はWeb3Authダッシュボード側の作業
2. Didit実書類での本人確認(同意済みメンバーの正規書類)
3. PSA実番号での照会(PSA_API_TOKEN設定後)
4. ブラウザでの一連のフロー(出品ウィザード→購入→発送→完了画面)の見た目・文言
