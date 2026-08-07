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
pnpm vitest run tests/health.test.ts   # 単一テストファイル
pnpm vitest run -t "returns 200"       # 名前で単一テストを指定
pnpm build            # tsc -> dist/(本番ビルドの確認用)
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

## アーキテクチャ

**業務ロジックはすべてbackendが持ち、frontendは持たない。** これはNext.jsのデフォルトの使い方とは異なる、意図的な分離である。Server Actionsは意図的に使わず、`frontend/`のサーバー側コードはSSR/画面描画(レンダリング時にbackendからデータを取得する)に限定される。画面表示後のインタラクション(フォーム送信・ポーリング・購入操作等)は、Next.js側のAPI/プロキシ層を経由せず、ブラウザから直接`backend/`を`fetch`で呼ぶ想定。backendのロジックを重複させるServer ActionsやNext.js API routesを追加しないこと。詳細は[docs/design/system-architecture.md §5.1](docs/design/system-architecture.md)を参照。

**`backend/`のapp/server分割はテスト容易性のため**: `src/app.ts`は`serve()`を呼ばずに設定済みの`Hono`インスタンス(ルーティング+CORS)をexportする。`serve()`を呼ぶのは`src/index.ts`だけ。これによりテストは実ポートを立てずに`app.request(...)`でルートを叩ける — `backend/tests/health.test.ts`が実例で、`../src/db.js`を`vi.mock`でモックしているためPostgresの実接続なしでテストできる。新しいルートを追加する際もこのパターンに従うこと。

**Docker Compose内とスタンドアロン開発でのネットワーキングの違い**: コンテナ同士はComposeのサービス名で到達する(`localhost`ではない) — backendはPostgresを`db:5432`で、frontendのSSR fetchはbackendを`http://backend:8080`で呼ぶ。各アプリの`.env.example`にスタンドアロン開発時のフォールバック値(`localhost`)とCompose経由での注入値の違いをコメントしてある。`backend/src/index.ts`は他コンテナから到達できるよう、loopbackのデフォルトではなく明示的に`0.0.0.0`にバインドしている。

**`poc/ekyc/`は稼働中のコードではなく参照実装。** DiditのeKYC APIを一気通貫で動かした最初の単一プロセスNext.js + SQLiteのプロトタイプである(セッション作成、Webhook署名検証、ステータス正規化、監査証跡)。その業務ロジック — `poc/ekyc/src/lib/didit/{client,normalize,signature}.ts`と`poc/ekyc/src/lib/db.ts` — はフレームワーク非依存なTypeScriptで書かれており、`backend/`への移植元として想定されているが、**その移植はまだ行われていない**(`backend/`は現状`/healthz`ルートのみ)。`poc/ekyc/`に新機能を追加するのではなく、そこからロジックを`backend/`へ移植すること。移行計画は[docs/design/system-architecture.md §4](docs/design/system-architecture.md)を参照。

**eKYC設計から引き継ぐべき設計原則**([docs/design/ekyc-design.md §2.1](docs/design/ekyc-design.md))。新しいbackend機能にも一般化して適用する:
- サーバー間通信の結果のみを信用する(署名検証済みWebhook、または直接のAPI照会) — ブラウザのリダイレクト/コールバックを何かの証明として信用しない。
- 必要以上のPIIを保存しない(セッションID・正規化ステータス・各チェック結果は保存するが、氏名・住所・身分証画像等は保存しない)。
- 外部の未知/未対応のステータスはフェイルセーフ(閉じる)側に倒す(例: Diditの未知ステータスは自動承認ではなく`in_review`に正規化される)。
- 1つのチェックを通過した(例: eKYC `approved`)からといって無制限の信頼を与えない — 段階的な制限をかけ、実績に応じて緩和する。

**データ層**: 本番・ローカルともにPostgreSQL。本番はCloud SQL(既存インスタンスを流用するため、スキーマ/エンジンの新規選定は不要)、Docker Composeのローカル開発では素の`postgres:16-alpine`コンテナを使う。`backend/src/db.ts`が唯一の`pg.Pool`を持ち、`DATABASE_URL`未設定時はimport時にthrowする(最初のクエリで失敗するのではなく、fail fastさせる)。

**Node/Nextのバージョン**: `backend/`・`frontend/`のDockerfileは`node:24-alpine`に固定。`frontend/`と`poc/ekyc/`はどちらも`next@16.2.12`に固定しており、両方に「このNext.jsのバージョンは学習データと異なる破壊的変更がある」という趣旨の`AGENTS.md`の警告がある。どちらのディレクトリでも見慣れないNext.js APIを使う前に`node_modules/next/dist/docs/`を確認すること。

## 変更前に読んでおくべきドキュメント

- [docs/design/system-architecture.md](docs/design/system-architecture.md) — 目標アーキテクチャ、PoCからの移行計画、機能ごとの設計(PSA API/Vision APIによるカード真贋チェック、ブロックチェーン監査証跡)、そして未決定事項の一覧(9節) — 何かが「決定済み」と思い込む前に確認すること。
- [docs/design/ekyc-design.md](docs/design/ekyc-design.md) — eKYC設計の全体(Didit連携、ステータス正規化表、Webhook署名検証方式)。
- [docs/design/seller-onboarding-review-flow.md](docs/design/seller-onboarding-review-flow.md) — 販売者登録〜審査の全体シーケンス。未実装の運営者による人手審査フローを含む。
