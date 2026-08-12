# Trustca — ポケモンカードC2Cマーケットプレイス

高額トレーディングカード(ポケモンカード等)のC2C売買における「偽物の出品」「状態の虚偽表示」「盗品・不正アカウント」という3つの信頼問題に対し、**eKYCによる販売者本人確認を起点**とした事前型審査で立ち向かうマーケットプレイス構想。

既存サービス(magi・スニーカーダンク・メルカリ あんしん鑑定)が実績を待つ事後型の信頼担保に留まる中、Trustcaは**出品前の入口で審査する**ポジショニングを取る。詳細は[競合調査](docs/research/trustca-market-research.md)を参照。

---

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/design/system-architecture.md](docs/design/system-architecture.md) | システムアーキテクチャ設計書。フロント/バックエンド構成、インフラ、機能ごとのアーキテクチャ、未決定事項 |
| [docs/design/database-schema.md](docs/design/database-schema.md) | Cloud SQL for PostgreSQLのスキーマ、ER図、制約、索引、migration・outbox運用 |
| [docs/design/ekyc-design.md](docs/design/ekyc-design.md) | eKYC設計書。5層信頼モデル、Didit採用理由、ステータス正規化、本番移行方針 |
| [docs/design/seller-onboarding-review-flow.md](docs/design/seller-onboarding-review-flow.md) | 販売者登録〜審査の全体フロー(運営者による人手審査を含む) |
| [docs/design/folder-structure.md](docs/design/folder-structure.md) | `frontend/`・`backend/`それぞれの新規ファイルの配置ルール |
| [docs/research/trustca-market-research.md](docs/research/trustca-market-research.md) | 競合調査・ギャップ分析 |
| [docs/mtg/](docs/mtg/) | 定例MTGの議事録(マインドマップ) |

---

## リポジトリ構成

```
/
├── docs/                設計・調査ドキュメント(上表)
├── frontend/            Next.js(App Router)。Firebase App HostingでSSR
├── backend/             Hono API(TypeScript)。Cloud Runにデプロイ
├── poc/ekyc/            eKYCフローのPoC実装(Next.js + SQLite、Didit本番APIと疎通検証済み。参照専用)
├── docker-compose.yml   ローカル開発用(frontend/backend/db)
└── README.md            本ファイル
```

`poc/ekyc/`は最初のフェーズで作った検証用実装で、以後は`frontend/`(Next.js)と`backend/`(Hono)に分離した構成で開発を進める。`poc/ekyc/src/lib/didit/`配下の業務ロジックは、`backend/`への移植元として参照専用で残している(まだ移植は未着手)。

---

## ローカル開発

```bash
docker compose up
```

- frontend: http://localhost:3000
- backend: http://localhost:8080/healthz
- db: PostgreSQL(localhost:5432)

他プロジェクトのコンテナ等とホスト側ポートが衝突する場合は、`.env.example`を`.env`にコピーして`DB_PORT`・`BACKEND_PORT`・`FRONTEND_PORT`を変更する(コンテナ間通信の内部ポートは固定なので影響しない)。

```bash
cp .env.example .env
# .env を編集してポートを変更
docker compose up
```

各アプリを単体で起動する場合はそれぞれの`README.md`([frontend/README.md](frontend/README.md) / [backend/README.md](backend/README.md) / [poc/ekyc/README.md](poc/ekyc/README.md))を参照。

---

## 開発方針

- コーディングエージェント: Claude Code
- フロントエンド: Next.js(Firebase App Hosting) — サーバー側の役割はSSR等の画面描画補助まで。業務ロジックは持たない
- バックエンド: TypeScript(Hono) / Cloud Run — 業務ロジックを一元化
- DB: GCP CloudSQL(PostgreSQL、王さんの環境の既存インスタンスを流用)
- ローカル開発: Docker Compose
- 仕様駆動開発: [GitHub spec-kit](https://github.com/github/spec-kit)を導入(`.claude/skills/speckit-*`)。機能追加時は`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`の流れを使う

未決定事項(フロントエンドのホスティング先の最終確定、GCPプロジェクト構成など)は[システムアーキテクチャ設計書 9節](docs/design/system-architecture.md#9-未決定事項一覧)を参照。
