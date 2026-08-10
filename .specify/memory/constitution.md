<!--
SYNC IMPACT REPORT
Version change: 1.0.0 → 1.0.1 (PATCH — non-semantic refinement)
Modified principles: I-V — removed per-principle "Rationale" prose that duplicated
  CLAUDE.md / docs/design/*.md content; kept only the MUST/MUST NOT statement + reference link.
  Governance section also clarified: docs/design/*.md is the source of truth, this file is a
  lean copy kept in sync with it (previously stated the opposite precedence).
Added sections: none
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed
  - .specify/templates/spec-template.md ✅ no change needed
  - .specify/templates/tasks-template.md ✅ no change needed
Follow-up TODOs: none
-->

# Trustca Constitution

## Core Principles

### I. フロントエンド/バックエンドの責務分離
業務ロジックはすべてbackendが持ち、frontendは持たない。Server Actions・Next.js API Routesを追加してbackendのロジックを重複させてはならない(MUST NOT)。frontendのサーバー側コードはSSR/画面描画に付随する処理までに限定する。
参照: [docs/design/system-architecture.md §5.1](../../docs/design/system-architecture.md), [docs/design/folder-structure.md §1](../../docs/design/folder-structure.md)

### II. フォルダ構成規約の遵守
新規ファイルは[docs/design/folder-structure.md](../../docs/design/folder-structure.md)の配置ルールに従わなければならない(MUST)。
参照: [docs/design/folder-structure.md](../../docs/design/folder-structure.md)

### III. poc/ekyc/は参照専用
`poc/ekyc/`は稼働中のコードではなく参照実装である。新機能を`poc/ekyc/`に追加してはならない(MUST NOT)。業務ロジックは`backend/`へ移植する対象として扱う。
参照: [docs/design/system-architecture.md §4](../../docs/design/system-architecture.md)

### IV. eKYC設計から引き継ぐ信頼設計の原則
新しいbackend機能にも以下を一般化して適用しなければならない(MUST): (1) サーバー間通信の結果のみを信用し、ブラウザ経由の値を信用しない。(2) 必要以上のPIIを自社に保存しない。(3) 外部の未知・未対応のステータスはフェイルセーフ(閉じる)側に倒す。(4) 1つのチェックの通過をもって無制限の信頼を与えず、段階的に制限を緩和する。
参照: [docs/design/ekyc-design.md §2.1](../../docs/design/ekyc-design.md)

### V. データ層の一元管理
`backend/src/db.ts`が唯一の`pg.Pool`を持つ。`DATABASE_URL`未設定時はimport時にthrowしfail fastしなければならない(MUST)。DB接続を他のモジュールから直接生成してはならない(MUST NOT)。
参照: `backend/src/db.ts`, [CLAUDE.md](../../CLAUDE.md)

## 技術スタック・開発環境の制約

- フロントエンド: Next.js(App Router)。Firebase App HostingでSSR。
- バックエンド: TypeScript / Hono。Cloud Runにデプロイ。
- DB: PostgreSQL(本番はGCP Cloud SQLの既存インスタンスを流用)。
- ローカル開発: Docker Compose(リポジトリルートから`docker compose up --build`)。
- `frontend/`・`backend/`・`poc/ekyc/`はそれぞれ独立したpnpmパッケージ(pnpm workspaceではない)。`pnpm install`は各ディレクトリで個別に実行する。

参照: [CLAUDE.md](../../CLAUDE.md), [docs/design/system-architecture.md §1](../../docs/design/system-architecture.md)

## 開発ワークフロー

- 変更前に[docs/design/system-architecture.md](../../docs/design/system-architecture.md)(9節の未決定事項含む)・[ekyc-design.md](../../docs/design/ekyc-design.md)・[seller-onboarding-review-flow.md](../../docs/design/seller-onboarding-review-flow.md)・[folder-structure.md](../../docs/design/folder-structure.md)を確認する。
- コード変更の検証は各アプリの`lint`/`typecheck`/`test`コマンドをホストで直接実行する(Docker Composeは`lint`/`test`/`build`を実行しない)。

参照: [CLAUDE.md](../../CLAUDE.md)

## Governance

`docs/design/`配下の各設計書が原則の内容についての正(source of truth)であり、本憲章はそれを`/speckit-plan`等の自動チェックが参照できる形に薄く写したものである。設計書側のルールが変わったときは、本憲章側も`/speckit-constitution`で追随して更新する(本憲章を先に変えてdocs側を後追いさせない)。各原則は説明文を持たず、MUST/MUST NOT文と参照リンクのみで構成し、詳細な背景・理由はリンク先のドキュメントに一本化する。

バージョニングはセマンティックバージョニングに従う: MAJOR = 原則の後方互換性のない削除・再定義、MINOR = 原則の追加・大幅な拡張、PATCH = 文言修正等の非意味的変更。

**Version**: 1.0.1 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-11
