# Feature Specification: プロダクト完成(全画面・認証・出品・購入・発送・管理)

**Feature Branch**: `feat/product-completion`
**Created**: 2026-08-20
**Status**: In Progress
**Input**: 「画面設計ドキュメント整備、Web3Auth二重入口の認証機能、出品・購入・発送・購入完了フローの実装、管理コンソール整備。完了後にGCPへ本番デプロイ可能な状態にする」

## 1. 目的

既存の設計書(docs/design/ 全9冊)と実装済み基盤(eKYC・PSA照会・Vision解析・SIWE・JPYC決済・監査anchor)の上に、**ユーザーが環境変数を用意すれば本番公開できる完成状態**まで到達する。既存設計からの逸脱は行わない。設計書に未定義の領域(発送フロー・配送先PII)のみ、本specで設計を追加する。

## 2. スコープ

| # | ブロック | 内容 |
|---|---|---|
| A | 画面設計 | 全画面の設計書(docs/design/screen-design.md)+ フロントエンド基盤(Tailwind CSS v4 + shadcn/ui + デザイントークン) |
| B | 認証機能 | ログイン二重入口(①外部ウォレット直結 ②Google/Discord/X ソーシャル→Embedded Wallet)。両経路とも既存のSIWE(challenges/verifications)でTrustca sessionへ収束。認証済みユーザー ↔ wallet ↔ seller_profile ↔ eKYC を単一の販売者身元として紐付け |
| C | 出品フロー | listings API(api-catalog §6.5 の契約通り)+ 出品ウィザードUI(カード情報→画像アップロード→PSA照会 or Vision解析→確認→公開)。eKYC承認・seller_limits・Cert重複をbackendで強制 |
| D | 購入フロー | orders API + 購入UI(出品詳細→注文→JPYC決済→確定)。決済確定は既存worker。注文確定時に監査イベント(audit_events + onchain_outbox)を業務transactionへ組込み |
| E | 発送・完了 | 新設計: shipments(追跡番号+キャリア+状態機械)、orders状態拡張(paid→shipped→delivered→completed)、配送先住所の最小PII設計。発送入力画面・物流追跡画面・取引完了画面(丁寧に作る) |
| F | 管理コンソール | 既存(eKYC審査・画像解析)を統合ダッシュボード化し、出品管理・取引一覧を追加 |
| G | 品質・受入 | 全ブロックのユニットテスト、migrationテスト、E2E、受入チェックリスト、GCPデプロイ手順書 |

### スコープ外

- Stripe等の法定通貨決済(本期はJPYCのみ)
- エスクロー・代理送金・自動返金(jpyc-payment.md §3.2 の通り)
- 配送業者APIとの実連携(追跡番号手入力+状態機械。公式追跡ページへのリンクのみ)
- 紛争(dispute)処理の完全実装(orders状態にdisputedは存在。運用画面は取引一覧からの状態確認まで)
- 実際のGCPリソース作成・デプロイ実行(手順書と設定ファイルまで。実行はユーザー検収後)

## 3. 受入基準(ユーザー検収チェックリスト)

### A. 画面設計
- [ ] docs/design/screen-design.md に全画面・遷移・状態(空/ローディング/エラー)・モーダル・文言方針が定義されている
- [ ] 実装画面が設計書と一致している(乖離があれば設計書側を先に更新している)

### B. 認証
- [ ] 未ログイン状態でヘッダーの「ログイン」から、①外部ウォレット ②Google/Discord/X の両経路でログインできる
- [ ] どちらの経路でも SIWE 署名 → Trustca session が発行され、リロード後もセッション復元できる(トークンはメモリ保持+再署名なし復元はWeb3Auth/wagmi側の再接続で実現)
- [ ] ログイン済みユーザーが販売者登録すると users↔seller_profiles が紐付き、eKYC承認後に isSellingAllowed=true となる
- [ ] 同一walletの別ユーザーへの二重紐付けがDB制約で拒否される

### C. 出品
- [ ] eKYC未承認の販売者は出品APIで拒否される(UI上も導線が閉じる)
- [ ] PSAあり経路: Cert番号照会→verified で「PSA登録情報確認済み」バッジ付き出品が作成できる
- [ ] PSAなし経路: 画像アップロード+Vision解析を経て出品が作成できる
- [ ] 同一Cert番号の二重出品がDB制約と409で拒否される
- [ ] seller_limits(出品数上限・金額上限)を超える出品が拒否される
- [ ] 公開一覧・出品詳細で信頼シグナル(本人確認済み/PSA登録情報確認済み/画像解析済み)が個別表示される

### D. 購入・決済
- [ ] 購入者がログイン→注文作成→listing が reserved になる
- [ ] JPYC送金→tx hash登録→workerのreceipt検証→payment=confirmed / order=paid / listing=sold が1 transactionで確定する
- [ ] 注文・決済の確定イベントが audit_events + onchain_outbox に記録され、anchor tx hash を注文詳細から参照できる
- [ ] 自己購入は拒否される。金額・宛先はブラウザ申告値でなくDB snapshotから検証される

### E. 発送・完了
- [ ] 販売者が発送情報(キャリア+追跡番号)を登録すると order=shipped になる
- [ ] 購入者・販売者の双方が追跡画面で状態タイムライン(支払確定→発送→受領→完了)を確認できる
- [ ] 購入者が受領確認すると delivered→completed へ遷移し、完了画面(取引サマリ+信頼シグナル+監査記録リンク)が表示される
- [ ] 配送先住所は注文単位で最小保存され、取引当事者と運営者以外は参照できず、保持期限列を持つ
- [ ] 不正な状態遷移(未発送での受領確認等)は409で拒否される

### F. 管理コンソール
- [ ] ADMIN_API_TOKEN による認可で /admin 配下が保護される(未設定時は常に401)
- [ ] eKYC in_review の承認/却下、画像解析の要確認一覧(既存)がダッシュボードから到達できる
- [ ] 出品一覧(強制close可)・取引一覧(状態確認)が使える

### G. 品質
- [ ] backend: lint / typecheck / test 全green、新規サービスにユニットテスト、migrationテスト(test:db)通過
- [ ] frontend: lint / build 通過
- [ ] E2E: 出品→購入→決済→発送→完了 の一連がローカル(Docker Compose --profile blockchain)で通る
- [ ] プロジェクト内の文言・コメント・ドキュメントがすべて日本語(中国語なし)
- [ ] docs/deploy/gcp-deployment.md にデプロイ手順(Cloud Run/Cloud SQL/Firebase App Hosting/Secret Manager/必要env一覧)が揃っている

## 4. 設計上の決定(本specで新規に定義するもの)

既存設計書に未定義の3点のみ。他はすべて既存設計に従う。

1. **発送状態機械**: orders に `shipped` / `delivered` を追加(migration 0004)。`paid → shipped → delivered → completed`。`disputed` への分岐は paid/shipped/delivered から可(既存設計の disputed を維持)
2. **shipments テーブル**: order 1件に対し現行1件(再発送はstatus管理)。carrier(選択式)+ tracking_number + shipped_at / delivered_at。追跡はキャリア公式ページへの外部リンク(API連携なし)
3. **配送先住所(PII)**: `order_shipping_addresses` を注文単位で新設。氏名・郵便番号・住所・電話を保存する唯一の場所とし、(a)取引当事者+運営者のみ参照可、(b)`retention_until` を持つ(既定: 取引完了から90日)、(c)audit_events / ログ / オンチェーンへ一切含めない。暗号化はCloud SQL保存時暗号化(既定)+アクセス制御で担保し、アプリ層暗号化は本番前の別Issueとする — database-schema.md §12「配送先PII」の穴埋めであり、PII最小化原則(氏名等をこれ以外の場所に持たない)は維持する

## 5. 参照

- 絶対制約: docs/design/ 全9冊(特に api-catalog.md §6.5-6.7、database-schema.md、jpyc-payment.md、folder-structure.md)
- 認証実装の参考: WHXisWH/Node-Stay(Web3Auth Modal 二重入口+SIWE。ただし nonce はDB保存済みの既存実装を使用)
- UI参考: WHXisWH/Trading-Panda(トークン設計・LP構成)、WHXisWH/alpaca-invoice(shadcn/ui・フォーム/進行UI)。ただしTrustcaは「安心・安全」基調のライトテーマ
