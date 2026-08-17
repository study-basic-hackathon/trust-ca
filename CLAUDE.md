# CLAUDE.md

このファイルは、このリポジトリで作業するClaude Code (claude.ai/code) にガイダンスを提供する。

## プロジェクト概要

Trustca — 高額トレーディングカード(ポケモンカード)のC2Cマーケットプレイス。既存サービスが事後的な信頼シグナルに頼るのに対し、**出品前の事前審査**(eKYC+カード真贋チェック)で差別化する。詳細は[README.md](README.md)と[docs/design/system-architecture.md](docs/design/system-architecture.md)を参照。

## リポジトリ構成

```
/
├── frontend/    Next.js(App Router)。Firebase App HostingでSSR
├── backend/     Hono API(TypeScript)。Cloud Runにデプロイ
├── poc/ekyc/    参照専用のPoC(Next.js + SQLite) — 詳細は下記
└── docs/        design/, research/, mtg/
```

`frontend/`・`backend/`・`poc/ekyc/`は**pnpm workspaceではなく、それぞれ独立したpnpmパッケージ**である。それぞれが独自のロックファイルと独自の`pnpm-workspace.yaml`を持つ(この`pnpm-workspace.yaml`はpnpmのビルドスクリプト許可リスト専用で、例えばbackendは`onlyBuiltDependencies: [esbuild]`、frontend/pocは`ignoredBuiltDependencies: [sharp, unrs-resolver]`)。`pnpm install`は各ディレクトリで個別に実行する。

## コマンド

**アプリを実際に動かす場合は常にDocker Compose(リポジトリルートから)**:
```bash
docker compose up --build
# frontend: localhost:3000, backend: localhost:8080/healthz, db: localhost:5432のPostgres
```
ホスト側ポートが既に使われている場合は、リポジトリルートの`.env.example`を`.env`にコピーして`DB_PORT`・`BACKEND_PORT`・`FRONTEND_PORT`を変更する。コンテナ内部のポートやサービス間通信には影響しない。

以下は各アプリでコード変更を検証するための一発コマンド(Docker Composeは`lint`/`test`/`build`を実行しないため、変更を検証する際はホストで直接叩く)。特に断りのない限り`backend/`または`frontend/`内で実行する。

**backend/**
```bash
pnpm lint
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm test:db          # 一時PostgreSQL schemaでmigration・制約を検証(TEST_DATABASE_URL必須)
pnpm vitest run tests/health.test.ts   # 単一テストファイル
pnpm vitest run -t "returns 200"       # 名前で単一テストを指定
pnpm build            # tsc -> dist/(本番ビルドの確認用)
pnpm db:migrate       # 未適用SQL migrationを適用
pnpm db:migrate:status # 適用状況・checksumを確認
```

**frontend/**
```bash
pnpm lint
pnpm build
```

**poc/ekyc/**(参照用PoC。Docker Composeには含まれない独立プロジェクトで、動かす場合は`pnpm dev`。Diditのセットアップ手順は自身のREADMEを参照)
```bash
pnpm dev
pnpm vitest run
pnpm vitest run --coverage   # src/lib/**に80%の閾値を強制
```

## spec-kit(仕様駆動開発)

[GitHub spec-kit](https://github.com/github/spec-kit)をClaude Code統合で導入済み(`.claude/skills/speckit-*`・`.specify/`)。機能追加時は`/speckit-specify`(仕様作成) → `/speckit-plan`(実装計画) → `/speckit-tasks`(タスク分解) → `/speckit-implement`(実装)の順で使う。必要に応じて`/speckit-clarify`(仕様の曖昧箇所を質問で潰す)・`/speckit-analyze`(仕様/計画/タスク間の整合性チェック)・`/speckit-checklist`を挟む。`.specify/memory/constitution.md`は`/speckit-constitution`が未実行のためテンプレートのまま(全機能で必須の前提ではない)。

## アーキテクチャ

**業務ロジックはすべてbackendが持ち、frontendは持たない。** これはNext.jsのデフォルトの使い方とは異なる、意図的な分離である。Server Actionsは意図的に使わず、backendのロジックを重複させるServer ActionsやNext.js API routesを追加しないこと。詳細・配置ルールは[docs/design/system-architecture.md §5.1](docs/design/system-architecture.md)・[docs/design/folder-structure.md §1](docs/design/folder-structure.md)を参照。

**`backend/`のapp/server分割はテスト容易性のため**: `serve()`を呼ぶのは`src/index.ts`だけ。新しいルートを追加する際もこのパターンに従うこと。詳細は[docs/design/folder-structure.md §2](docs/design/folder-structure.md)・[backend/README.md](backend/README.md)を参照。

**Docker Compose内とスタンドアロン開発でのネットワーキングの違い**: コンテナ同士はComposeのサービス名で到達する(`localhost`ではない) — backendはPostgresを`db:5432`で、frontendのSSR fetchはbackendを`http://backend:8080`で呼ぶ。各アプリの`.env.example`にスタンドアロン開発時のフォールバック値(`localhost`)とCompose経由での注入値の違いをコメントしてある。`backend/src/index.ts`は他コンテナから到達できるよう、loopbackのデフォルトではなく明示的に`0.0.0.0`にバインドしている。

**`poc/ekyc/`は稼働中のコードではなく参照実装であり、`backend/`への移植はまだ行われていない**(`backend/`は現状`/healthz`ルートのみ)。`poc/ekyc/`に新機能を追加するのではなく、そこからロジックを`backend/`へ移植すること。差分・移行計画は[docs/design/system-architecture.md §4](docs/design/system-architecture.md)を参照。

**eKYC設計から引き継ぐべき設計原則**([docs/design/ekyc-design.md §2.1](docs/design/ekyc-design.md)・[docs/design/system-architecture.md §8](docs/design/system-architecture.md))。新しいbackend機能にも一般化して適用する: サーバー間通信の結果のみを信用する/必要以上のPIIを保存しない/未知・未対応のステータスはフェイルセーフ(閉じる)側に倒す/1つのチェック通過で無制限の信頼を与えない。各原則の詳細は上記リンク先を参照。

**データ層**: 本番・ローカルともにPostgreSQL(本番はCloud SQLの既存インスタンスを流用)。`backend/src/db.ts`が唯一の`pg.Pool`を持ち、`DATABASE_URL`未設定時はimport時にthrowする(fail fast)。インフラ詳細は[docs/design/system-architecture.md §7](docs/design/system-architecture.md)を参照。

**DB migration**: SQLの正は`backend/src/db/migrations/`。適用済みファイルは編集せず、変更は新しいversionで追加する。スキーマ・制約・Cloud SQL運用は[docs/design/database-schema.md](docs/design/database-schema.md)を参照。

**Node/Nextのバージョン**: `backend/`・`frontend/`のDockerfileは`node:24-alpine`に固定。`frontend/`と`poc/ekyc/`はどちらも`next@16.2.12`に固定しており、見慣れないNext.js APIを使う前に`node_modules/next/dist/docs/`を確認すること(詳細は各ディレクトリの`AGENTS.md`)。

## 変更前に読んでおくべきドキュメント

- [docs/design/system-architecture.md](docs/design/system-architecture.md) — 目標アーキテクチャ、PoCからの移行計画、機能ごとの設計(PSA API/Vision APIによるカード真贋チェック、ブロックチェーン監査証跡)、そして未決定事項の一覧(9節) — 何かが「決定済み」と思い込む前に確認すること。
- [docs/design/database-schema.md](docs/design/database-schema.md) — PostgreSQLのtable、関係、制約、索引、migration、transactional outbox、PII境界。
- [docs/design/api-catalog.md](docs/design/api-catalog.md) — 外部・内部APIのendpoint、認証、再試行、冪等性、秘密情報、失敗時の扱い。外部連携や新規routeの実装前に確認すること。
- [docs/design/ekyc-design.md](docs/design/ekyc-design.md) — eKYC設計の全体(Didit連携、ステータス正規化表、Webhook署名検証方式)。
- [docs/design/seller-onboarding-review-flow.md](docs/design/seller-onboarding-review-flow.md) — 販売者登録〜審査の全体シーケンス。未実装の運営者による人手審査フローを含む。
- [docs/design/folder-structure.md](docs/design/folder-structure.md) — `frontend/`・`backend/`それぞれの新規ファイルの配置ルール(routes/services/db層、型定義の置き場所等)。
