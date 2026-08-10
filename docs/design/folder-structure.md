# フロント/バックのフォルダ構成

二人で並行して開発するにあたり、新しいファイルをどこに置くか毎回相談しなくて済むように、`frontend/`・`backend/`それぞれの配置ルールを定義する。対象読者はフロントエンド・バックエンドの実装を担当する開発者。

現状(2026年8月10日時点)は`backend/`が`/healthz`のみ、`frontend/`が疎通確認ページのみのスケルトン状態のため、本書は「今あるファイル一覧」ではなく「機能を追加するときにどこに置くか」というルールとして書く。全体のアーキテクチャ方針・移行計画は[system-architecture.md](./system-architecture.md)を参照。

---

## 1. 前提: フロント/バックの役割分担

[system-architecture.md §5.1](./system-architecture.md)・[frontend/README.md](../../frontend/README.md)の通り、**業務ロジックはすべて`backend/`が持ち、`frontend/`は持たない**。

- `frontend/`のサーバー側コードは、SSR時にbackendから取得したデータを描画するだけに限定する。Server Actions・Next.js API Routesは追加しない。
- 画面表示後のインタラクション(フォーム送信・ポーリング・購入操作等)は、ブラウザから`backend/`のAPIを直接`fetch`する。

この分担を踏まえ、以下のフォルダ構成もそれぞれ独立したルールとして定義する(`frontend/`・`backend/`は別々のpnpmパッケージであり、コードの共有はしない)。

---

## 2. `backend/`

### 2.1 ディレクトリ構成

```
backend/
├── src/
│   ├── index.ts        # エントリポイント。serve()を呼ぶのはここだけ
│   ├── app.ts           # Honoインスタンス本体(ルーティング+CORS)。serve()を呼ばない
│   ├── db.ts             # pg.Poolを1つだけ生成・export。DATABASE_URL未設定ならimport時にthrow
│   ├── routes/           # HTTPルーティング層。エンドポイント単位でファイルを分ける
│   │   └── health.ts
│   ├── services/          # ルーティングから呼ばれる業務ロジック(未作成。機能追加時に新設)
│   └── db/                # SQLクエリ・スキーマ関連(未作成。機能追加時に新設)
├── tests/
│   └── health.test.ts     # `../src/app.js`をapp.request()で叩く。DBはvi.mockでモック
├── Dockerfile
└── package.json
```

### 2.2 配置ルール

| 追加したいもの | 置き場所 | 命名・分割の目安 |
|---|---|---|
| 新しいAPIエンドポイント | `src/routes/<リソース名>.ts` | `health.ts`に倣い、リソース(`sellers`・`cards`等)単位で1ファイル。`app.ts`で`app.route("/", xxxRoute)`のように登録する |
| ルートから呼ばれる業務ロジック(バリデーション・外部API呼び出し等) | `src/services/<リソース名>.ts` | ルートハンドラ本体を薄く保つため、複雑になってきたら切り出す。`poc/ekyc/src/lib/didit/{client,normalize,signature}.ts`が移植元(system-architecture.md §4.2) |
| DBクエリ | `src/db/<リソース名>.ts` | `src/db.ts`(Pool生成)とは別。Poolを受け取ってクエリを実行する関数群を置く |
| 外部サービスへの認証情報・設定値の読み取り | `src/env.ts`(未作成。必要になったら新設) | `process.env`への直接アクセスをここに集約する。参考: `poc/ekyc/src/lib/env.ts` |
| 型定義(ドメイン型・リクエスト/レスポンス型等) | 当面は`routes/`・`services/`内にコロケーション。複数ファイルで共有するようになったら`src/types/<ドメイン名>.ts`に切り出す(未作成。必要になったら新設) | 最初から`types/`を作らない。同じ型を2箇所以上でimportし始めたタイミングで切り出す |
| テスト | `tests/<対象と同じ相対パス>.test.ts` | `tests/health.test.ts`と同じ構成。DB接続が絡む場合は`vi.mock("../src/db.js", ...)`でモックし、実DBなしで実行できるようにする |

### 2.3 迷ったときの指針

- `src/app.ts`と`src/index.ts`の分割はテスト容易性のためなので崩さない([CLAUDE.md](../../CLAUDE.md)参照)。新しいルートも`app.ts`に集約登録する形を踏襲する。
- `poc/ekyc/`からロジックを移植する際も、この`routes/` → `services/` → `db/`の3層に当てはめて配置する(`poc/ekyc/`側の`src/lib/`が概ね`services/`、`src/lib/db.ts`が`db/`に対応する)。

---

## 3. `frontend/`

### 3.1 ディレクトリ構成

```
frontend/
├── src/
│   ├── app/                # Next.js App Router。ルーティング=ディレクトリ構造
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── <route>/
│   │       └── page.tsx     # 画面追加時はここにディレクトリを切る
│   ├── components/          # 複数ページ・画面内で再利用するUIコンポーネント(未作成。機能追加時に新設)
│   └── lib/                  # backend呼び出しのfetchラッパー等、UIに依存しない関数(未作成。機能追加時に新設)
├── Dockerfile
└── package.json
```

### 3.2 配置ルール

| 追加したいもの | 置き場所 | 備考 |
|---|---|---|
| 新しい画面 | `src/app/<パス>/page.tsx` | App Routerの規約通り、URLパスとディレクトリ構造を一致させる |
| SSR時のbackend fetch処理 | 各`page.tsx`内、または`src/lib/api/<リソース名>.ts`に切り出す | `page.tsx`の`getBackendHealth()`(`frontend/src/app/page.tsx`)が現状唯一の例。同種の処理が増えたら`src/lib/`に切り出す |
| クライアント側からのbackend直接fetch(フォーム送信・購入操作等) | 各Client Component内、または`src/lib/api/<リソース名>.ts` | Server Actions・Next.js API Routesは経由しない(§1) |
| 複数画面で使うUI部品 | `src/components/<コンポーネント名>.tsx` | 特定の画面でしか使わないものは`app/`配下のcolocationで置いてよい(Next.js App Routerの標準的な慣習) |
| 型定義(APIレスポンス型・ドメイン型等) | 当面は使用箇所(`page.tsx`・`lib/api/xxx.ts`等)にコロケーション。複数箇所で共有するようになったら`src/types/<ドメイン名>.ts`に切り出す(未作成。必要になったら新設) | backendと同じ考え方。最初から`types/`を作らない |

### 3.3 迷ったときの指針

- `BACKEND_URL`は環境ごとに値が変わる(Docker Compose内は`http://backend:8080`、スタンドアロンは`http://localhost:8080`)。`frontend/.env.example`のコメント通り、直書きせず`process.env.BACKEND_URL`経由で参照する。
- 見慣れないNext.js APIを使う前に`node_modules/next/dist/docs/`を確認する([CLAUDE.md](../../CLAUDE.md)・`frontend/AGENTS.md`参照。`next@16.2.12`は学習データと異なる破壊的変更がある)。

---

## 4. スコープ外

- `poc/ekyc/`のフォルダ構成(参照専用PoCであり、移植元としてのみ扱う。構成は現状のまま)
- インフラ・IaC関連のファイル配置(未着手。[system-architecture.md §9](./system-architecture.md#9-未決定事項一覧)の未決定事項)
- テストのディレクトリ構成の詳細ルール(現状`backend/tests/`のみ運用実績があり、frontendはテスト未整備)
