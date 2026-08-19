# Implementation Plan: Vision APIによるカード画像コンテンツチェックMVP

**Branch**: `feat/16-vision-authenticity` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/019-vision-card-authenticity/spec.md`

## Summary

出品者が出品時にカード四隅等の画像を、購入者が到着後に同一箇所の再撮影画像をCloud Storageへアップロードできるようにし、到着後画像に対してCloud Vision API(OCR・ラベル検出・オブジェクト位置検出)を実行して、出品時に申告されたカード名・型番との内容整合性を`内容整合`/`要確認`に正規化する。物理的な個体同一性の照合(自社比較ロジック)は対象外とし、既存の`cards`/`card_images`/`card_image_analyses`スキーマの上にHono routes/servicesを追加するMVPとして実装する。

## Technical Context

**Language/Version**: TypeScript 5、Node.js 24、React 19

**Primary Dependencies**: Hono 4、`google-auth-library`(新規・Vision API用access token取得)、`@google-cloud/storage`(新規・V4署名付きURL発行)、Next.js 16.2.12

**Storage**: PostgreSQL(既存の`cards`/`card_images`/`card_image_analyses`テーブル。新規migrationなし) + 非公開Cloud Storageバケット(画像本体。DBにはmetadataのみ)

**Testing**: Vitest(Vision API・GCSはモック。`services/psa.ts`のテスト方針を踏襲)、ESLint、`tsc --noEmit`、Next.js production build

**Target Platform**: Cloud Run backend、Firebase App Hosting frontend

**Project Type**: frontend/backend分離Webアプリ(業務ロジックはbackendのみ)

**Performance Goals**: Vision API呼び出しはタイムアウト+最大1回再試行。到着後画像アップロードから結果表示まで数十秒〜数分以内(spec.md SC-002)

**Constraints**: Vision認証情報・GCS署名鍵をブラウザへ渡さない。未知・不確実な判定は`要確認`に倒す。画像本体をDBへ保存しない。`cards`/`listings`の作成機能自体は本機能のスコープ外(research.md §7)

**Scale/Scope**: アップロードURL発行1endpoint、画像登録1endpoint、解析実行1endpoint、解析結果取得(単体・運営者向け一覧)2endpoint

## Constitution Check

- [x] 業務ロジックはbackendに限定。frontendはアップロードUIとbackend直接fetchのみ(Server Actions・API Routesを追加しない)。
- [x] `routes/` → `services/` → `db/`の配置規約に準拠(folder-structure.md §2.2)。
- [x] `poc/ekyc/`は変更しない。
- [x] サーバー間のVision API応答のみを信用し、ブラウザから送られた解析結果は受け付けない。未知・不確実な判定は`in_review`/`要確認`に倒す(FR-006)。物理的な同一個体照合という「1つのチェックでの無制限信頼」を意図的に対象外にした(FR-012)。
- [x] `backend/src/db.ts`の単一Poolを再利用し、新規Pool生成やDB直結クライアントを作らない。

設計後の再確認でも違反なし(Phase 1完了後)。

## Project Structure

### Documentation (this feature)

```text
specs/019-vision-card-authenticity/
├── plan.md              # このファイル
├── research.md          # Phase 0 出力
├── data-model.md         # Phase 1 出力
├── quickstart.md         # Phase 1 出力
└── tasks.md              # Phase 2 出力(/speckit-tasksで作成、本コマンドでは作らない)
```

### Source Code (repository root)

```text
backend/src/
├── env.ts                              # getVisionConfig()を追加(既存getPsaConfig等と同じ形)
├── routes/
│   ├── card-image-uploads.ts           # POST /api/v1/uploads/card-images
│   ├── card-images.ts                  # POST /api/v1/cards/{cardId}/images(アップロード完了登録)
│   └── card-image-analyses.ts          # POST /api/v1/card-image-analyses, GET .../{analysisId}, GET一覧(運営者向け)
├── services/
│   ├── storage.ts                      # 署名付きURL発行、アップロード済みobjectの検証(@google-cloud/storage)
│   ├── vision.ts                       # Vision API images:annotate呼び出し + タイムアウト/再試行(fetch + google-auth-library)
│   └── card-image-analysis.ts          # OCR結果とcards.name/card_numberの突合、status/score算出(data-model.md参照)
└── db/
    ├── card-images.ts                  # card_imagesへのinsert/select(Poolを受け取る関数群)
    └── card-image-analyses.ts          # card_image_analysesへのinsert/select

backend/tests/
├── card-image-uploads-route.test.ts
├── card-images-route.test.ts
├── card-image-analyses-route.test.ts
├── card-image-analysis-service.test.ts  # OCR突合ロジックの単体テスト(data-model.mdの判定表を網羅)
└── vision-service.test.ts               # 再試行・タイムアウト・エラー分類

frontend/src/app/
└── cards/[cardId]/images/               # 出品時アップロード・到着後アップロード・結果表示の画面コロケーション(未作成。着手時に新設)

docs/design/api-catalog.md               # 6.4節の既存記載(POST /uploads/card-images等)を実装内容に合わせて更新
```

**Structure Decision**: `backend/`は既存のroutes/services/db 3層構成(folder-structure.md §2.1)にそのまま従う。`frontend/`は既存の`psa-verification-form.tsx`と同様、クライアントコンポーネントから直接backendへfetchする1画面を追加する。新規Hono routeは`app.ts`に`app.route("/", ...)`で登録する(既存パターンと同一)。

## Complexity Tracking

*Constitution Check違反なし。本セクションは記入不要。*
