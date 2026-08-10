<!--
SYNC IMPACT REPORT
Version change: [TEMPLATE] → 1.0.0 (initial ratification)
Modified principles: N/A — initial version establishes 5 principles:
  - I. フロントエンド/バックエンドの責務分離
  - II. フォルダ構成規約の遵守
  - III. poc/ekyc/は参照専用
  - IV. eKYC設計から引き継ぐ信頼設計の原則
  - V. データ層の一元管理
Added sections: Core Principles (I-V), 技術スタック・開発環境の制約, 開発ワークフロー, Governance
Removed sections: none (template placeholders replaced with concrete content)
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution Check section is generic, reads this file at runtime)
  - .specify/templates/spec-template.md ✅ no change needed
  - .specify/templates/tasks-template.md ✅ no change needed
Follow-up TODOs: none
-->

# Trustca Constitution

## Core Principles

### I. フロントエンド/バックエンドの責務分離
業務ロジックはすべてbackendが持ち、frontendは持たない。Server Actions・Next.js API Routesを追加してbackendのロジックを重複させてはならない(MUST NOT)。frontendのサーバー側コードはSSR/画面描画に付随する処理までに限定する。
Rationale: Next.jsのデフォルトの使い方とは異なる意図的な分離であり、業務ロジックを一箇所(`backend/`)に集約することで実装の重複・不整合を防ぐ。
参照: [docs/design/system-architecture.md §5.1](../../docs/design/system-architecture.md), [docs/design/folder-structure.md §1](../../docs/design/folder-structure.md)

### II. フォルダ構成規約の遵守
新規ファイルは[docs/design/folder-structure.md](../../docs/design/folder-structure.md)の配置ルールに従わなければならない(MUST)。`backend/`は`routes/`(ルーティング)→`services/`(業務ロジック)→`db/`(クエリ)の3層構造、`frontend/`は`app/`(ルーティング)・`components/`(再利用UI)・`lib/`(backend呼び出し等)に配置する。型定義は当面コロケーションとし、複数箇所で共有する必要が生じた時点で`types/`へ切り出す。
Rationale: 二人体制での並行開発において、ファイルの置き場所を都度相談しなくて済むようにするため。
参照: [docs/design/folder-structure.md](../../docs/design/folder-structure.md)

### III. poc/ekyc/は参照専用
`poc/ekyc/`は稼働中のコードではなく参照実装である。新機能を`poc/ekyc/`に追加してはならない(MUST NOT)。業務ロジックは`backend/`へ移植する対象として扱う。
Rationale: PoCはフレームワーク非依存な設計になっており移植コストは小さいが、稼働系と参照実装が混在すると保守対象が二重化する。
参照: [docs/design/system-architecture.md §4](../../docs/design/system-architecture.md)

### IV. eKYC設計から引き継ぐ信頼設計の原則
新しいbackend機能にも以下を一般化して適用しなければならない(MUST): (1) サーバー間通信の結果のみを信用し、ブラウザ経由の値を信用しない。(2) 必要以上のPIIを自社に保存しない。(3) 外部の未知・未対応のステータスはフェイルセーフ(閉じる)側に倒す。(4) 1つのチェックの通過をもって無制限の信頼を与えず、段階的に制限を緩和する。
Rationale: 「出品前の事前審査」という本プロダクトの差別化要素を、機能が増えても崩さないため。
参照: [docs/design/ekyc-design.md §2.1](../../docs/design/ekyc-design.md)

### V. データ層の一元管理
`backend/src/db.ts`が唯一の`pg.Pool`を持つ。`DATABASE_URL`未設定時はimport時にthrowしfail fastしなければならない(MUST)。DB接続を他のモジュールから直接生成してはならない(MUST NOT)。
Rationale: 接続プールが複数箇所に分散すると、接続数の制御・設定変更が困難になるため。
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

本憲章はCLAUDE.md・`docs/design/`配下の各設計書と矛盾しないことを前提とする。矛盾が判明した場合は本憲章を優先し、docs側を後から更新する。原則の追加・変更は該当する`docs/design/`配下の設計書を更新した上で、`/speckit-constitution`を再実行して本ファイルに反映する。

バージョニングはセマンティックバージョニングに従う: MAJOR = 原則の後方互換性のない削除・再定義、MINOR = 原則の追加・大幅な拡張、PATCH = 文言修正等の非意味的変更。

**Version**: 1.0.0 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-11
