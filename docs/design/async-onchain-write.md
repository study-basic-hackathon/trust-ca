# 取引情報の非同期オンチェーン記録設計書

Issue [#17](https://github.com/study-basic-hackathon/trust-ca/issues/17) のMVP設計と実装契約を定義する。対象は、Trustcaで確定した業務イベントをPostgreSQLへ保存し、その改竄検知用hashをEVM互換chainへ非同期に記録する経路である。

本書では、業務処理の成否をchainの応答時間から切り離しつつ、再起動や一時障害が起きても未処理イベントを回収できることを優先する。

---

## 1. 結論

- 正本はCloud SQL for PostgreSQLの`audit_events`とする。
- 業務イベントと`onchain_outbox`は**同じDB transaction**でcommitする。
- chainには原文や個人情報を保存せず、`eventKey`、`payloadHash`、`occurredAt`だけを記録する。
- workerは`FOR UPDATE SKIP LOCKED`でjobをclaimし、RPC呼び出し中にDB transactionを保持しない。
- transaction hashを保存し、再起動後は同じtransactionのreceipt確認を再開する。
- contractも同一eventの再送を許容し、異なるhashだけをrevertする。
- MVPはDB polling workerで検証する。本番ではCloud Tasks + OIDCによる起動通知を追加しても、outboxを配送の正本として残す。

---

## 2. 対象範囲

### 2.1 MVPで実装するもの

1. 監査イベント登録用の内部API
2. canonical JSONとSHA-256 payload hashの生成
3. PostgreSQL transactional outbox
4. 複数worker間の排他claim、再試行、dead letter状態
5. viemを使うEVM RPC clientとreceipt確認
6. `TrustcaAuditAnchor` Solidity contract
7. Hardhat local chain、contract deploy、workerを含むDocker Compose profile
8. unit test、PostgreSQL統合テスト、HTTP→DB→worker→contractのE2E

### 2.2 対象外

- JPYC送金、Web3Auth、注文決済の状態遷移（Issue #18で実装）
- 業務サービスの既存transactionへoutbox生成を直接組み込む作業
- Polygon Amoy / mainnetへの実deployとgas運用
- Cloud Tasks dispatcherとOIDC endpointの本番実装
- chainへ保存した原文から業務データを復元する機能

---

## 3. 全体構成

```mermaid
flowchart LR
    Business[業務service] -->|同一DB transaction| Audit[(audit_events)]
    Business -->|同一DB transaction| Outbox[(onchain_outbox)]
    Worker[Onchain worker] -->|SKIP LOCKEDでclaim| Outbox
    Worker -->|simulate / send / receipt| RPC[EVM JSON-RPC]
    RPC --> Contract[TrustcaAuditAnchor]
    Worker -->|tx hash / block / confirmed| Outbox
    Internal[内部API] --> Business

    Contract -. 保存しない .-> PII[氏名・住所・カード画像・raw payload]
```

業務transactionのcommit後にRPC送信する。chainが停止していても業務transactionは成立し、outboxが再試行対象として残る。

---

## 4. Node-Stayからの移行判断

参考実装: [WHXisWH/Node-Stay](https://github.com/WHXisWH/Node-Stay)

| Node-Stayの考え方 | Trustcaでの判断 | 理由 |
|---|---|---|
| provider、signer、chain ID、contract、operatorを起動時に検証 | `AuditAnchorClient.assertReady()`へ移植 | 誤chain・誤contract・誤operatorでの送信を起動前に止めるため |
| receiptとconfirmationを確認 | viemの`waitForTransactionReceipt`で移植 | transaction送信だけを成功扱いしないため |
| block cursorを永続化してlistenerを再開 | 設計思想をoutboxの`tx_hash`とstatusへ適用 | MVPはtransaction単位の配送なので、block cursorよりjobごとの再開点が明確なため |
| browserの`localStorage`へ同期jobを保存 | 移植しない | browser終了・storage削除・別端末利用で配送保証を失うため |
| 業務更新後にfire-and-forgetでchain送信 | 移植しない | DB commitとjob生成の間でprocessが停止するとイベントを回収できないため |

Node-StayのEVM接続・再開可能性は活かし、配送の正本だけをbrowserからPostgreSQLへ移す。

---

## 5. 登録フロー

```mermaid
sequenceDiagram
    autonumber
    participant Caller as 内部caller
    participant API as Hono API
    participant DB as PostgreSQL
    participant Worker as Onchain worker
    participant RPC as EVM RPC
    participant Contract as AuditAnchor

    Caller->>API: POST /internal/onchain-anchors<br/>Idempotency-Key相当 + event payload
    API->>API: canonical化 + SHA-256
    API->>DB: BEGIN
    API->>DB: audit_events INSERT
    API->>DB: onchain_outbox INSERT
    API->>DB: COMMIT
    API-->>Caller: 202 pending

    loop polling
        Worker->>DB: claim (FOR UPDATE SKIP LOCKED)
    end
    Worker->>RPC: chain / bytecode / operator確認
    Worker->>RPC: simulateContract
    Worker->>Contract: anchor(eventKey, payloadHash, occurredAt)
    Contract-->>Worker: tx hash
    Worker->>DB: tx hash保存
    Worker->>RPC: receipt待機
    RPC-->>Worker: success + block number
    Worker->>DB: confirmedへ更新
```

APIの`202`は「outbox登録済み」を示し、オンチェーン確定を示さない。callerはstatus APIで`confirmed`を確認する。

---

## 6. データ契約

### 6.1 `audit_events`

| 列 | 用途 |
|---|---|
| `id` | UUID。contractの`eventKey`生成元 |
| `idempotency_key` | callerが安定して生成する再送識別子 |
| `aggregate_type` / `aggregate_id` | 対象entity（例: `order`とorder ID） |
| `event_type` / `event_version` | event schemaの識別 |
| `canonical_payload` | 改竄検知対象の正規化済みJSON |
| `payload_sha256` | contractへ記録する64桁lowercase hex |
| `occurred_at` | 業務イベント発生日時 |

### 6.2 `onchain_outbox`

| 列 | 用途 |
|---|---|
| `status` | `pending / processing / submitted / confirmed / retry / dead` |
| `chain_id` / `contract_address_normalized` | 誤配送を防ぐ宛先snapshot |
| `attempt_count` / `next_attempt_at` | backoff制御 |
| `locked_at` / `locked_by` | workerの論理lock |
| `tx_hash` / `block_number` | 送信済みtransactionと確定block |
| `last_error_code` / `last_error_message` | PIIを含まない運用情報 |

詳細なDDLは`backend/src/db/migrations/0001_initial_schema.sql`、全体ERは[database-schema.md](./database-schema.md)を参照する。

### 6.3 canonical JSON

MVPのcanonical化規則は次の通り。RFC 8785準拠を標榜せず、Trustca内部のversion付き規則として扱う。

- object keyをECMAScriptの既定の文字列順序で再帰的にsortする
- arrayの順序を維持する
- `null`、boolean、string、finite numberだけを許可する
- `JSON.stringify`のUTF-8 bytesへSHA-256を適用する
- 同じevent versionで規則を変更しない

外部providerのraw response、API key、氏名、住所、画像、wallet秘密鍵はpayloadへ含めない。

---

## 7. Contract仕様

`blockchain/contracts/TrustcaAuditAnchor.sol`は最小のappend-only anchorである。

| Solidity値 | 生成方法 |
|---|---|
| `eventKey: bytes32` | `keccak256(UTF8(auditEventId))` |
| `payloadHash: bytes32` | `0x` + `audit_events.payload_sha256` |
| `occurredAt: uint64` | `occurred_at`のUnix seconds |

`anchor`の動作:

1. operator以外の呼び出しをrevertする。
2. 未登録`eventKey`はhashを保存し、eventをemitする。
3. 同じ`eventKey`と同じhashの再送は成功するが、状態を変更しない。
4. 同じ`eventKey`と異なるhashはrevertする。

contractへ業務payloadを保存しないため、DB内容の機密性はchainから失われない。ただしevent数・送信時刻・operator address等の公開metadataは観測可能である。

---

## 8. Worker状態遷移

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> processing: claim
    retry --> processing: next_attempt_at到達
    submitted --> processing: receipt再確認
    processing --> confirmed: receipt success
    processing --> retry: 送信前の一時error
    processing --> submitted: tx hashありの一時error
    processing --> dead: 非再試行error / 最大回数
    processing --> processing: lock timeout後に別workerが再claim
```

### 8.1 排他とtransaction境界

- claimはCTE内の`FOR UPDATE SKIP LOCKED`と`UPDATE ... RETURNING`を1 statementで行う。
- RPC呼び出し中はDB row lockやDB transactionを保持しない。
- workerは同じoperator nonceの競合を避けるため、1 batch内を直列処理する。
- `processing`のlockがtimeoutしたjobは、停止したworkerの代わりに別workerが再claimできる。

### 8.2 再試行

- 送信前の一時障害は`retry`へ戻す。
- tx hash取得後のreceipt timeoutは`submitted`とし、同じtx hashを再確認する。
- backoffは30秒から始めてattemptごとに2倍、最大1時間とする。
- 非再試行errorまたは8回到達で`dead`とする。
- `dead`は自動で再送しない。operatorが原因を確認し、新しい運用手順または修正migrationで回収する。

processがtransaction送信後、tx hashのDB保存前に停止した場合でも、contractの冪等性により次回の再送は安全である。同じhashなら成功し、異なるhashなら明示的に停止する。

---

## 9. 内部API

### 9.1 監査イベント登録

`POST /api/v1/internal/onchain-anchors`

```json
{
  "idempotencyKey": "order.completed:018f1e4c-2d4a-7fd0-8ab3-c8f76a9b12de",
  "aggregateType": "order",
  "aggregateId": "018f1e4c-2d4a-7fd0-8ab3-c8f76a9b12de",
  "eventType": "order.completed",
  "eventVersion": 1,
  "occurredAt": "2026-08-13T00:00:00.000Z",
  "payload": {
    "orderId": "018f1e4c-2d4a-7fd0-8ab3-c8f76a9b12de",
    "paymentStatus": "confirmed"
  }
}
```

- `Authorization: Bearer <ONCHAIN_INTERNAL_TOKEN>`が必須。
- 新規登録は`202`、同一内容の再送は同じIDで`200`を返す。
- 同じidempotency keyに異なる内容を送ると`409 IDEMPOTENCY_CONFLICT`。
- payload上限は32 KiB。

### 9.2 状態取得

`GET /api/v1/internal/onchain-anchors/:auditEventId`

`status`、payload hash、attempt数、tx hash、block number、confirmed時刻、最終error codeを返す。raw payloadや秘密情報は返さない。

Bearer tokenはMVPのローカル検証用である。本番のservice間認証にはCloud Run IAM / OIDCを使用し、公開clientからこのAPIを直接呼ばせない。

---

## 10. 本番GCP構成

MVPの常駐polling workerをそのまま多数scaleさせると、空pollとoperator nonce競合が増える。本番候補は次の構成とする。

```mermaid
flowchart LR
    API[Cloud Run API] -->|transactional outbox| SQL[(Cloud SQL)]
    Dispatcher[Cloud Run Job / dispatcher] -->|pendingを検索| SQL
    Dispatcher -->|event IDをtask名に利用| Tasks[Cloud Tasks]
    Tasks -->|OIDC付きHTTP| Worker[Cloud Run worker]
    Worker -->|job IDでclaim| SQL
    Worker --> RPC[Polygon RPC]
    Scheduler[Cloud Scheduler] -->|取りこぼし回収| Dispatcher
```

Cloud Tasksは起動通知とrate制御に使い、配送状態の正本にはしない。DB commit後・task作成前に停止する隙間はdispatcherの定期scanで回収する。task名はidempotency keyをhash化して重複を抑え、HTTP targetにはOIDC tokenを付与する。

同一operator walletで送信するworkerの並列度は1、またはnonce managerを導入して明示制御する。RPC provider、Polygon network、confirmation数、gas補充・alert条件は本番deploy前に確定する。

---

## 11. Security / 運用

| 項目 | MVP | 本番要件 |
|---|---|---|
| operator key | Hardhat公開開発key | Secret Manager + 専用wallet。repository、image、logへ残さない |
| 内部認証 | 32文字以上のBearer token | Cloud Run IAM / OIDC。token audienceも検証 |
| chain data | hashと時刻だけ | payload allowlistとPII reviewをCI/設計reviewへ追加 |
| RPC | local Hardhat | provider redundancy、timeout、rate limit、chain ID監視 |
| retry | DB backoff、最大8回 | `dead`件数・最古pending時間・receipt timeoutを監視 |
| contract権限 | 単一operator変更機能 | multisig / key rotation手順、監査済みdeploy address |

最低限の監視指標:

- status別outbox件数
- 最古`pending/retry/submitted`の経過時間
- `dead`増加数と`last_error_code`
- submit成功率、receipt確定時間、RPC error率
- operator native token残高
- 設定chain ID / contract bytecode / contract operatorの不一致

logへpayload、Bearer token、private key、RPC credentialを出力しない。

---

## 12. ローカル検証

```bash
cp .env.example .env
# .envのONCHAIN_MVP_ENABLEDをtrueへ変更
docker compose --profile blockchain up --build
```

別terminalでE2Eを実行する。

```bash
cd backend
BACKEND_URL=http://localhost:8080 \
ONCHAIN_RPC_URL=http://localhost:8545 \
ONCHAIN_INTERNAL_TOKEN=local-onchain-internal-token-change-me \
pnpm test:onchain:e2e
```

PostgreSQL outboxだけを実DBで検証する場合:

```bash
cd backend
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trustca \
pnpm test:onchain:db
```

テストはランダム名の一時schemaを作成し、終了時にそのschemaだけを削除する。

---

## 13. 検証済み項目

- Solidity buildと5 contract test
- backend unit test（canonical化、route、worker、health）
- backend lint、typecheck、build
- 実PostgreSQLでtransactional登録、冪等性、競合、2 worker同時claim、receipt保存
- Docker Composeでmigration → local chain → deploy → backend / worker起動
- HTTP登録 → PostgreSQL → worker → contract → receipt → status APIのE2E

本MVPはIssue #14 / PR #27の`audit_events`と`onchain_outbox` schemaへ依存する。PR #27を先にmergeし、その後に本機能branchをmainへ取り込む。

---

## 14. 参考資料

- [Hardhat 3 Getting Started](https://hardhat.org/docs/getting-started)
- [Hardhat 3: Testing with viem](https://hardhat.org/docs/guides/testing/using-viem)
- [viem: writeContract](https://viem.sh/docs/contract/writeContract)
- [viem: Public Client](https://viem.sh/docs/clients/public)
- [Cloud Tasks: HTTP target task](https://cloud.google.com/tasks/docs/creating-http-target-tasks)
- [PostgreSQL: SELECT locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
