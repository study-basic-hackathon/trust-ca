# Research: Vision APIによるカード画像コンテンツチェックMVP

## 1. 既存DBスキーマの再利用(新規migrationなし)

**Decision**: `backend/src/db/migrations/0001_initial_schema.sql`に`cards`・`card_images`・`card_image_analyses`が実装済みであり、本機能は新規migrationを追加せずこの3テーブルの上にroutes/servicesを実装する。

**Rationale**: `card_images.image_kind`は`front/back/label/corner_*/possession`をカバーし、`card_image_analyses.analysis_kind`は`ocr/label_detection/object_localization/image_comparison`を持つ。後者はまさに前回のspecスコープ議論(Vision APIでできる内容整合性チェック=`ocr`/`label_detection`/`object_localization` と、対象外にした自社比較ロジック=`image_comparison`)と一致する。スキーマ設計時点(#14)で既にこの境界が意図されていたと判断できる。

**Alternatives considered**: 新しいテーブルを追加する案は、既存スキーマが要件を満たしているため不要と判断し却下。

## 2. `image_comparison`(自社比較ロジック)は実装しない

**Decision**: `card_image_analyses.analysis_kind = 'image_comparison'`および`comparison_image_id`列は本MVPでは使用しない(常にNULL)。

**Rationale**: 前段のユーザーとの合意により、物理的な同一個体照合はVision API単体では実現できず、精度検証を要する別タスクとして切り出した(spec.md FR-012・Assumptions)。列・enum値はスキーマ上残しておき、将来の別タスクがそのまま使えるようにする。

## 3. Vision API呼び出し方式: REST + `google-auth-library`(SDKではなく既存パターンを踏襲)

**Decision**: `@google-cloud/vision`等のSDKは追加せず、既存の`services/psa.ts`と同じ「素の`fetch` + タイムアウト + 最大1回再試行」パターンで`POST https://vision.googleapis.com/v1/images:annotate`を呼ぶ。認証は`google-auth-library`の`GoogleAuth`でCloud Run付与のADCからaccess tokenを取得し、`Authorization: Bearer`で送る。

**Rationale**: このリポジトリは外部API呼び出しに重量級SDKを避け、`fetch`ベースの薄いクライアントを`services/`に置く一貫したスタイルを取っている(PSA・JPYC決済のいずれも同様)。`google-auth-library`はトークン取得のみに使う最小限の追加依存で、SDK全体を導入するより一貫性が高い。

**Alternatives considered**: `@google-cloud/vision`公式SDK — 認証・再試行を肩代わりしてくれるが、依存が重く、このリポジトリの既存流儀(PSAクライアントの自前実装)から逸脱するため見送り。

## 4. Cloud Storage署名付きURL発行: `@google-cloud/storage`を新規追加

**Decision**: V4署名付きURLの生成だけは`@google-cloud/storage`を新規依存として追加する。Cloud Run実行サービスアカウントに`roles/iam.serviceAccountTokenCreator`(自己impersonation)を付与し、鍵ファイルなしでADCベースの署名を行う。

**Rationale**: V4署名アルゴリズムの自前実装は複雑でセキュリティリスクが高く、車輪の再発明を避けるべき領域(V1原則で挙げた「fetchの自前実装」とは性質が異なる、暗号署名処理)。api-catalog.md §5.5で署名付きURL発行が既に前提とされている。

**Note(インフラ未決定事項)**: `roles/iam.serviceAccountTokenCreator`の付与は本番Cloud Runサービスアカウントへのインフラ設定が必要(system-architecture.md §9系の未決定事項に準じる)。ローカルDocker Compose検証では、開発者個人のADC(`gcloud auth application-default login`)またはモック実装で代替する。

## 5. 解析は同期実行(worker/outboxを新設しない)

**Decision**: `POST /api/v1/card-image-analyses`のリクエストハンドラ内でVision API呼び出し・正規化・DB書き込みまでを同期的に行う。`card_image_analyses.status`は`pending`/`processing`を経由せず、完了時点で`completed`/`in_review`/`failed`のいずれかを直接book。

**Rationale**: Vision APIの`images:annotate`は数秒で応答するのが通常であり、SC-002(数十秒〜数分以内)を満たせる。PSA照会(`services/psa.ts`)も同じく同期呼び出し+タイムアウト+1回再試行のパターンを取っており、一貫性がある。`pending`/`processing`という状態値自体はスキーマに残るため、将来的にVision呼び出しが重くなった場合は`workers/onchain-anchor.ts`等と同じ非同期worker+outbox方式へ無停止で移行できる。

**Alternatives considered**: `onchain_outbox`と同様の非同期worker方式 — 決済・オンチェーン書き込みほどの信頼性要求(失敗時の永続再試行)はなく、MVPでは過剰な複雑度と判断し却下。

## 6. ユーザー識別: 既存のwallet-session JWTを流用

**Decision**: `backend/src/services/session-token.ts`の`WalletSession`(JPYC決済MVPで導入済みのSIWEベースJWT、`Authorization: Bearer`で検証)を、画像アップロード・解析APIの呼び出し主体識別にもそのまま使う。

**Rationale**: 現在`main`ブランチにマージ済みのbackendには、汎用的なユーザーセッション機構がwallet-session以外に存在しない(販売者eKYCセッションはissue #13のPRがまだ未マージ)。#13の完了を待つと本機能が不必要にブロックされるため、既存の仕組みを再利用する。`card_images.uploaded_by_user_id`・`cards.current_owner_id`との突合に`WalletSession.userId`をそのまま使う。

**Alternatives considered**: #13マージ後のeKYCセッションを前提にする — 依存関係が生まれ、無関係な機能追加まで#13のマージ待ちになるため却下。今後#13がマージされた際は、セッション統合を別タスクとして検討する。

## 7. `cards`/`listings`の作成自体はスコープ外という前提を維持

**Decision**: 本機能は既存の`card_id`(および`cards.name`/`series`/`card_number`)が既に存在することを前提とし、カード個体・出品の作成そのもの(roadmap優先6「基本的なカードの出品機能」)は実装しない。

**Rationale**: spec.md Assumptionsで既に「出品時画像あり」「到着後画像あり」という2イベントの存在を前提とすると明記済み。カード作成機能自体も別機能であり、これを本機能に含めると「自社比較ロジックを外して軽くする」という直前の合意と矛盾するスコープ拡大になる。MVP検証(quickstart.md)ではテスト用に`cards`行を直接INSERTして代替する。

## 8. 内容整合性の判定ロジック(保守的な包含チェック)

**Decision**: OCR全文(`TEXT_DETECTION`の`fullTextAnnotation.text`)を正規化(全角/半角統一、空白除去、大文字小文字統一)した上で、`cards.name`と`cards.card_number`(設定されていれば)がそれぞれ部分文字列として含まれるかを判定する。両方含まれ、かつ`LABEL_DETECTION`が事前定義したカード関連ラベル(例: "Trading card", "Playing card", "Card")をスコア閾値以上で検出していれば`completed`(内容整合)。いずれか欠けていれば`in_review`。

**Rationale**: 「未知・不確実は自動承認しない」(constitution原則IV)に最も安全に倒せる単純な実装。あいまい一致(編集距離等)は誤って`内容整合`にしてしまうリスクがあり、MVPでは見送る。

**Alternatives considered**: Levenshtein距離等によるあいまい一致スコアリング — 将来の精度改善候補として`normalized_result`にOCR全文を保存しておき、後から再判定できるようにする(データ自体は失わない設計)。

## 9. 未解決事項(実装着手前に確認)

- Cloud Run実行サービスアカウントへの`roles/iam.serviceAccountTokenCreator`付与(§4)。
- Vision APIの呼び出し量・課金上限(PSAと同様、system-architecture.md §9相当の未決定事項)。
- 非公開Cloud Storageバケット名・ライフサイクル設定(本番未作成)。
