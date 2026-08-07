# Trustca — ポケモンカードC2Cマーケットプレイス

高額トレーディングカード(ポケモンカード等)のC2C売買における「偽物の出品」「状態の虚偽表示」「盗品・不正アカウント」という3つの信頼問題に対し、**eKYCによる販売者本人確認を起点**とした事前型審査で立ち向かうマーケットプレイス構想。

既存サービス(magi・スニーカーダンク・メルカリ あんしん鑑定)が実績を待つ事後型の信頼担保に留まる中、Trustcaは**出品前の入口で審査する**ポジショニングを取る。詳細は[競合調査](docs/research/trustca-market-research.md)を参照。

---

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/design/system-architecture.md](docs/design/system-architecture.md) | システムアーキテクチャ設計書。フロント/バックエンド構成、インフラ、機能ごとのアーキテクチャ、未決定事項 |
| [docs/design/ekyc-design.md](docs/design/ekyc-design.md) | eKYC設計書。5層信頼モデル、Didit採用理由、ステータス正規化、本番移行方針 |
| [docs/design/seller-onboarding-review-flow.md](docs/design/seller-onboarding-review-flow.md) | 販売者登録〜審査の全体フロー(運営者による人手審査を含む) |
| [docs/research/trustca-market-research.md](docs/research/trustca-market-research.md) | 競合調査・ギャップ分析 |
| [docs/mtg/](docs/mtg/) | 定例MTGの議事録(マインドマップ) |

---

## リポジトリ構成

```
/
├── docs/            設計・調査ドキュメント(上表)
├── poc/ekyc/        eKYCフローのPoC実装(Next.js + SQLite、Didit本番APIと疎通検証済み)
└── README.md        本ファイル
```

`poc/ekyc/`は最初のフェーズで作った検証用実装で、[システムアーキテクチャ設計書](docs/design/system-architecture.md)に基づき、フロントエンド(Next.js)とバックエンド(Hono)を分離した構成へ移行していく。セットアップ手順は[poc/ekyc/README.md](poc/ekyc/README.md)を参照。

---

## 開発方針

- コーディングエージェント: Claude Code
- バックエンド: TypeScript(Hono) / Cloud Run
- DB: GCP CloudSQL
- ローカル開発: Docker Compose(構築中)

未決定事項(フロントエンドのホスティング先、GCPプロジェクト構成など)は[システムアーキテクチャ設計書 9節](docs/design/system-architecture.md#9-未決定事項一覧)を参照。
