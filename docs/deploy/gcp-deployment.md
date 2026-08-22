# GCP本番デプロイ手順書

**基準日: 2026年8月21日**

本書は、Trustcaを本番構成(backend: Cloud Run / frontend: Firebase App Hosting / DB: Cloud SQL for PostgreSQL)へデプロイする手順と、必要な環境変数・シークレットの一覧を定義する。アーキテクチャの前提は[system-architecture.md §7](../design/system-architecture.md)を参照。

前提: `gcloud` CLI・`firebase` CLIが認証済みで、対象GCPプロジェクトの編集権限があること。

---

## 0. 全体像

| コンポーネント | デプロイ先 | ソース |
|---|---|---|
| backend API | Cloud Run service `trustca-backend` | `backend/Dockerfile.prod` |
| payment worker | Cloud Run service `trustca-worker-payment`(常駐, min-instances=1) | 同上(commandを`worker:payment`へ) |
| onchain worker | Cloud Run service `trustca-worker-onchain`(常駐, min-instances=1) | 同上(commandを`worker:onchain`へ) |
| migration | Cloud Run Job `trustca-migrate` | 同上(command: `node scripts/migrate.mjs up`) |
| frontend | Firebase App Hosting | `frontend/apphosting.yaml` |
| DB | Cloud SQL for PostgreSQL(既存インスタンス流用を第一候補) | `backend/src/db/migrations/` |
| シークレット | Secret Manager | 下記一覧 |

```text
デプロイ順序: Cloud SQL準備 → Secret Manager → migration Job → backend → workers → frontend → 疎通確認
```

---

## 1. Cloud SQL の準備

[database-schema.md §10.2](../design/database-schema.md)の通り。

1. 既存instanceのPostgreSQL major versionを確認する(ローカル基準は16)。
   ```bash
   gcloud sql instances describe INSTANCE_NAME --format="value(databaseVersion)"
   ```
2. Trustca専用databaseとroleを作成する。
   ```bash
   gcloud sql databases create trustca --instance=INSTANCE_NAME
   gcloud sql users create trustca_app --instance=INSTANCE_NAME --password=<強力なパスワード>
   ```
3. backup / PITR の有効化状況を確認する。
4. 接続はCloud RunのCloud SQL接続(`--add-cloudsql-instances`)を使用する。`DATABASE_URL`は
   `postgresql://trustca_app:PASSWORD@localhost/trustca?host=/cloudsql/PROJECT:REGION:INSTANCE_NAME` 形式。

## 2. Secret Manager

秘密値(下表で「秘密」列が○のもの)を登録する。

```bash
printf '%s' '<値>' | gcloud secrets create trustca-database-url --data-file=-
# 同様に: trustca-didit-api-key / trustca-didit-webhook-secret / trustca-psa-token /
#         trustca-payment-session-secret / trustca-onchain-operator-key /
#         trustca-onchain-internal-token / trustca-admin-token / trustca-gemini-api-key(任意)
```

Cloud Run実行サービスアカウントへ`roles/secretmanager.secretAccessor`を付与する。

## 3. 環境変数一覧(backend / worker)

[api-catalog.md §9](../design/api-catalog.md)を正とする。デプロイ時に指定する主要値:

| 変数 | 秘密 | backend | worker-payment | worker-onchain | 備考 |
|---|:-:|:-:|:-:|:-:|---|
| `DATABASE_URL` | ○ | ✓ | ✓ | ✓ | Secret Manager |
| `FRONTEND_ORIGIN` | | ✓ | | | App HostingのURL(CORS) |
| `DIDIT_MVP_ENABLED` 他 `*_MVP_ENABLED` | | ✓ | | | 本番は全機能`true` |
| `DIDIT_API_KEY` / `DIDIT_WORKFLOW_ID` / `DIDIT_WEBHOOK_SECRET_KEY` | ○/-/○ | ✓ | | | |
| `PSA_API_TOKEN` / `PSA_API_BASE_URL` | ○/- | ✓ | | | |
| `GCP_PROJECT_ID` / `CARD_IMAGE_BUCKET` | | ✓ | | | 非公開bucketを事前作成 |
| `PAYMENT_MVP_ENABLED=true` | | ✓ | ✓ | | |
| `PAYMENT_RPC_URL` | ○ | ✓ | ✓ | | Polygon RPC(鍵付き) |
| `PAYMENT_CHAIN_ID=137` / `PAYMENT_CHAIN_NAME=Polygon` | | ✓ | ✓ | | |
| `PAYMENT_JPYC_TOKEN_ADDRESS` | | ✓ | ✓ | | 公式アドレスを複数人で確認([jpyc-payment.md §11](../design/jpyc-payment.md)) |
| `PAYMENT_EXPECTED_SYMBOL=JPYC` / `PAYMENT_CONFIRMATIONS` | | ✓ | ✓ | | |
| `PAYMENT_SESSION_SECRET` | ○ | ✓ | ✓ | | |
| `PAYMENT_SIWE_DOMAIN` / `PAYMENT_SIWE_URI` | | ✓ | ✓ | | frontendの公開ドメイン |
| `PAYMENT_WORKER_ID` | | | ✓ | | 例: `cloudrun-payment-1` |
| `ONCHAIN_MVP_ENABLED=true` | | ✓ | ✓ | ✓ | backend/worker-paymentは監査イベント作成に使用 |
| `ONCHAIN_RPC_URL` | ○ | ✓ | ✓ | ✓ | |
| `ONCHAIN_CHAIN_ID` / `ONCHAIN_CHAIN_NAME` | | ✓ | ✓ | ✓ | 監査anchor用chain |
| `ONCHAIN_ANCHOR_CONTRACT` | | ✓ | ✓ | ✓ | デプロイ済みTrustcaAuditAnchor |
| `ONCHAIN_OPERATOR_PRIVATE_KEY` | ○ | | | ✓ | Secret Manager。mainnet前にKMS再設計 |
| `ONCHAIN_INTERNAL_TOKEN` | ○ | ✓ | | ✓ | |
| `ADMIN_API_TOKEN` | ○ | ✓ | | | 管理コンソール共有シークレット |
| `VISION_MVP_ENABLED=true` / `GEMINI_API_KEY`(任意) | -/○ | ✓ | | | VisionはADC(サービスアカウント権限)で認証 |

frontend(App Hosting)は`frontend/apphosting.yaml`のプレースホルダを実値へ置き換える。

## 4. 監査anchorコントラクトのデプロイ

検証ネットワーク(Polygon Amoy)から始め、mainnetは[async-onchain-write.md §11](../design/async-onchain-write.md)の本番要件を満たしてから移行する。

```bash
cd blockchain
pnpm install
# hardhat.config.tsへ対象ネットワークとoperator鍵(環境変数)を設定した上で
pnpm hardhat run scripts/deploy-audit-anchor.ts --network <network>
```

出力されたアドレスを`ONCHAIN_ANCHOR_CONTRACT`へ設定する。

## 5. backendのビルドとデプロイ

```bash
cd backend
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/trustca/backend:v1 -f Dockerfile.prod .

# migration(Cloud Run Job)
gcloud run jobs create trustca-migrate \
  --image=REGION-docker.pkg.dev/PROJECT/trustca/backend:v1 \
  --command=node --args=scripts/migrate.mjs,up \
  --add-cloudsql-instances=PROJECT:REGION:INSTANCE_NAME \
  --set-secrets=DATABASE_URL=trustca-database-url:latest \
  --region=REGION
gcloud run jobs execute trustca-migrate --wait --region=REGION

# API本体
gcloud run deploy trustca-backend \
  --image=REGION-docker.pkg.dev/PROJECT/trustca/backend:v1 \
  --add-cloudsql-instances=PROJECT:REGION:INSTANCE_NAME \
  --allow-unauthenticated \
  --region=REGION \
  --set-secrets=DATABASE_URL=trustca-database-url:latest,DIDIT_API_KEY=trustca-didit-api-key:latest,... \
  --set-env-vars=FRONTEND_ORIGIN=https://<app-hosting-domain>,DIDIT_MVP_ENABLED=true,...

# worker(常駐。CPU always-allocated + min-instances=1)
gcloud run deploy trustca-worker-payment \
  --image=REGION-docker.pkg.dev/PROJECT/trustca/backend:v1 \
  --command=npm --args=run,worker:payment \
  --no-allow-unauthenticated --min-instances=1 --no-cpu-throttling \
  --add-cloudsql-instances=... --set-secrets=... --region=REGION
# trustca-worker-onchain も同様(args=run,worker:onchain)
```

- workerはHTTPを受けないため、ヘルスチェック要件に応じてstartup probeを無効化するか、将来Cloud Tasks構成([async-onchain-write.md §10](../design/async-onchain-write.md))へ移行する。
- デプロイ後、`https://<backend-url>/healthz`で`{"status":"ok","db":"ok"}`を確認する。

## 6. Didit Webhookの設定

Diditコンソールで本番アプリケーションのWebhook URLを
`https://<backend-url>/api/v1/webhooks/didit` に設定し、発行された`secret_shared_key`を
`DIDIT_WEBHOOK_SECRET_KEY`としてSecret Managerへ登録・再デプロイする。

## 7. frontend(Firebase App Hosting)

1. `frontend/apphosting.yaml`のプレースホルダ(`REPLACE_WITH_*`)を実値へ置き換える。
2. FirebaseコンソールまたはCLIでApp Hosting backendを作成し、GitHubリポジトリの`main`ブランチ・`frontend/`ディレクトリを接続する。
   ```bash
   firebase apphosting:backends:create --project=PROJECT --location=REGION
   ```
3. デプロイ完了後、発行されたドメインをbackendの`FRONTEND_ORIGIN`・`PAYMENT_SIWE_DOMAIN`・`PAYMENT_SIWE_URI`へ反映して再デプロイする。
4. Web3Authダッシュボードで本番Originを許可リストへ追加する。

## 8. デプロイ後の疎通確認(smoke test)

1. `GET /healthz` → `{"status":"ok","db":"ok"}`
2. frontendのLPが表示され、ログイン(Web3Authモーダル)が開く
3. SIWEログイン → `GET /api/v1/me`が200
4. 販売者登録 → Didit Hosted Flowへ遷移できる(本人確認は同意済みメンバーの実書類で実施)
5. PSA照会(`POST /api/v1/cards/psa-verifications`)が`verified`を返す(実カード番号)
6. テスト出品 → 一覧・詳細表示 → 少額注文 → JPYC送金 → worker確定 → 発送登録 → 受領確認 → 完了画面
7. 管理コンソール(`ADMIN_API_TOKEN`)で各一覧が表示される

## 9. 運用チェックリスト(本番公開前)

- [ ] [jpyc-payment.md §13](../design/jpyc-payment.md)の本番移行条件(RPC冗長化・法務レビュー等)
- [ ] [async-onchain-write.md §11](../design/async-onchain-write.md)の本番要件(KMS・監視)
- [ ] PSA API利用条件・上限の確認([api-catalog.md §11](../design/api-catalog.md))
- [ ] 古物営業法・特商法・個人情報保護の整理([ekyc-design.md §4.5](../design/ekyc-design.md))
- [ ] `order_shipping_addresses.retention_until`超過行の削除job(別Issue)
- [ ] Cloud Monitoringアラート([api-catalog.md §10](../design/api-catalog.md)の指標)

---

## 付録: 2026-08-21 初回デプロイの実績と注意点

| 項目 | 値 |
|---|---|
| GCPプロジェクト | `trust-ca-506116`(region: asia-northeast1) |
| frontend | https://trustca-frontend-86426383469.asia-northeast1.run.app |
| backend | https://trustca-backend-86426383469.asia-northeast1.run.app |
| Cloud SQL | `trustca-pg`(PostgreSQL 16, enterprise / db-f1-micro / HDD 10GB / zonal / backupなし = 最安構成) |
| worker | Cloud Run **worker pool** `trustca-worker-payment`(`gcloud beta run worker-pools`、scaling=1)。コマンドは`node dist/workers/payment-verification.js`(tsxはprod imageに無い) |
| 画像bucket | `gs://trust-ca-506116-card-images`(非公開) |
| migration | Cloud Run Job `trustca-migrate`(args: `scripts/migrate.mjs`。`up`引数は不要) |

運用上の注意:

1. **`/healthz`はrun.app URLでは外部から到達できない**(Google Frontendの予約パスで404になる)。外形監視には`/api/v1/listings`等を使う。コンテナ自体のprobeには影響しない。
2. **`polygon-rpc.com`は廃止済み**(401 tenant disabled)。keyless RPCは`https://polygon-bor-rpc.publicnode.com`を使用中。本番は専用RPC(Alchemy/Infura等)へ差し替えを推奨。
3. Cloud Run新プロジェクトのURLは決定的形式`https://SERVICE-PROJECT_NUMBER.REGION.run.app`が有効。
4. `ONCHAIN_MVP_ENABLED=false`で稼働中(監査anchor contract未デプロイのため)。有効化時はcontractデプロイ→env設定→worker-onchainのworker pool追加。
5. **署名付きURL生成には実行サービスアカウント自身への`roles/iam.serviceAccountTokenCreator`付与が必須**。Cloud Runには鍵ファイルが無いため、GCSの署名付きURL生成はIAMの`signBlob`を経由する。未付与だと画像アップロード/サムネイル取得が500(`Permission 'iam.serviceAccounts.signBlob' denied`)になる(ローカルは鍵ファイル署名のため再現しない)。付与コマンド: `gcloud iam service-accounts add-iam-policy-binding 86426383469-compute@developer.gserviceaccount.com --member="serviceAccount:86426383469-compute@developer.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator"`(2026-08-22適用済み)。
