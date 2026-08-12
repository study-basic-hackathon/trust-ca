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
├── scripts/
│   ├── migrate.mjs     # migration適用・状態確認CLI
│   ├── test-migrations.mjs # 一時schemaを使う統合テスト
│   ├── test-onchain-outbox.ts # outboxの実DB統合テスト
│   ├── test-onchain-e2e.mjs # local chainを含むE2E
│   └── lib/migrator.mjs # migration共通処理
├── src/
│   ├── index.ts        # エントリポイント。serve()を呼ぶのはここだけ
│   ├── app.ts           # Honoインスタンス本体(ルーティング+CORS)。serve()を呼ばない
│   ├── db.ts             # pg.Poolを1つだけ生成・export。DATABASE_URL未設定ならimport時にthrow
│   ├── env.ts            # 外部接続・worker設定の読み取りと検証
│   ├── blockchain/       # EVM client、ABI、chain接続のadapter
│   ├── routes/           # HTTPルーティング層。エンドポイント単位でファイルを分ける
│   │   ├── health.ts
│   │   └── onchain-anchors.ts
│   ├── services/         # 業務ロジック、canonical化、worker orchestration
│   ├── workers/          # HTTP serverと分離して起動するworker entrypoint
│   └── db/                # SQLクエリ・スキーマ関連
│       └── migrations/    # 番号付きSQL migration
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
| DBスキーマ変更 | `src/db/migrations/<4桁version>_<説明>.sql` | 適用済みファイルを編集せず、新しいversionを追加する。`pnpm db:migrate`で適用 |
| DB運用script | `scripts/` | アプリruntimeへ組み込まないmigration CLI・統合テスト。共通処理は`scripts/lib/`へ置く |
| 外部サービスへの認証情報・設定値の読み取り | `src/env.ts` | `process.env`への直接アクセスをここに集約する。秘密値をlogへ出さない |
| EVM / blockchain接続adapter | `src/blockchain/<用途>.ts` | ABIとRPC clientを置く。業務transactionやHTTP responseは扱わない |
| 独立processで動くworker | `src/workers/<用途>.ts` | signal処理、poll loop、resource closeを担当。処理本体は`services/`へ置く |
| 型定義(ドメイン型・リクエスト/レスポンス型等) | 当面は`routes/`・`services/`内にコロケーション。複数ファイルで共有するようになったら`src/types/<ドメイン名>.ts`に切り出す(未作成。必要になったら新設) | 最初から`types/`を作らない。同じ型を2箇所以上でimportし始めたタイミングで切り出す |
| テスト | `tests/<対象と同じ相対パス>.test.ts` | `tests/health.test.ts`と同じ構成。DB接続が絡む場合は`vi.mock("../src/db.js", ...)`でモックし、実DBなしで実行できるようにする |

### 2.3 迷ったときの指針

- `src/app.ts`と`src/index.ts`の分割はテスト容易性のためなので崩さない([CLAUDE.md](../../CLAUDE.md)参照)。新しいルートも`app.ts`に集約登録する形を踏襲する。
- `poc/ekyc/`からロジックを移植する際も、この`routes/` → `services/` → `db/`の3層に当てはめて配置する(`poc/ekyc/`側の`src/lib/`が概ね`services/`、`src/lib/db.ts`が`db/`に対応する)。
- schemaの正は`src/db/migrations/`に置き、repository内へ`CREATE TABLE`を埋め込まない。詳細は[database-schema.md](./database-schema.md)を参照する。
- RPC呼び出し中にDB transactionを保持しない。非同期配送は`onchain_outbox`等の永続queueを正本にし、browser storageへ置かない。

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

## 4. `blockchain/`

監査hash等のEVM contractはbackend packageへ混在させず、Hardhat用の独立packageとして配置する。

```text
blockchain/
├── contracts/       # Solidity source of truth
├── scripts/         # deploy等の短命script
├── test/            # contract test
├── hardhat.config.ts
├── Dockerfile
└── package.json
```

- contractへPII、画像、provider raw response、credentialを書き込まない。
- deploy address、chain ID、operatorをbackend起動時に検証する。
- local用の公開Hardhat keyを本番networkへ流用しない。
- contract interface変更時はbackend側ABIとE2Eも同じPRで更新する。

---

## 5. スコープ外

- `poc/ekyc/`のフォルダ構成(参照専用PoCであり、移植元としてのみ扱う。構成は現状のまま)
- インフラ・IaC関連のファイル配置(未着手。[system-architecture.md §9](./system-architecture.md#9-未決定事項一覧)の未決定事項)
- テストのディレクトリ構成の詳細ルール(現状`backend/tests/`のみ運用実績があり、frontendはテスト未整備)
