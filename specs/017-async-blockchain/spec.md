# Feature Specification: 取引情報の非同期オンチェーン記録

**Feature Branch**: `feat/17-async-blockchain`

**Created**: 2026-08-13

**Status**: Complete

**Input**: User description: "やりとりの情報を非同期でブロックチェーンに書き込む。Node-Stayを参考に、DBからの非同期オンチェーン記録をTrustcaへ移行できるMVPを作る"

## User Scenarios & Testing

### User Story 1 - 業務処理をchain障害から分離する (Priority: P1)

backendは、確定した業務イベントとオンチェーン配送jobを同一DB transactionで保存し、chainが停止中でも業務処理をcommitできる。

**Independent Test**: 実PostgreSQLへeventを登録し、`audit_events`と`onchain_outbox`が同時に作成されることを確認する。

**Acceptance Scenarios**:

1. **Given** 正しい監査イベント、**When** 内部APIへ登録する、**Then** `202`と`pending` statusを返す。
2. **Given** 同じidempotency keyと同じ内容、**When** 再送する、**Then** 同じevent IDを`200`で返す。
3. **Given** 同じidempotency keyと異なる内容、**When** 再送する、**Then** `409`で拒否する。

---

### User Story 2 - workerが安全に再試行できる (Priority: P1)

workerは複数instance間でjobを二重claimせず、transaction hashを保存して再起動後もreceipt確認を継続できる。

**Independent Test**: 2 workerが同時に1 jobをclaimし、取得件数の合計が1件になることを実PostgreSQLで確認する。

**Acceptance Scenarios**:

1. **Given** `pending` job、**When** 複数workerが同時claimする、**Then** 1 workerだけが取得する。
2. **Given** transaction hash保存済みjob、**When** receipt確認が一時失敗する、**Then** 新しいtransactionを送らず`submitted`から再確認する。
3. **Given** retry可能error、**When** 最大回数未満、**Then** exponential backoffで再試行する。
4. **Given** 非retry errorまたは最大回数到達、**When** 処理する、**Then** `dead`へ移行する。

---

### User Story 3 - 改竄検知用hashだけをchainへ固定する (Priority: P1)

operatorはevent IDとpayload hashをcontractへ記録でき、同一eventの安全な再送と異なるhashの競合検知ができる。

**Independent Test**: Hardhat上で初回anchor、同一hash再送、異なるhash、operator外callerの4 caseを検証する。

**Acceptance Scenarios**:

1. **Given** 未登録event、**When** operatorがanchorする、**Then** payload hashを保存してeventをemitする。
2. **Given** 登録済みeventと同じhash、**When** 再送する、**Then** revertせず状態を変更しない。
3. **Given** 登録済みeventと異なるhash、**When** 再送する、**Then** revertする。
4. **Given** operator以外、**When** anchorする、**Then** revertする。

### Edge Cases

- workerが送信直後・tx hash保存前に停止しても、contractの冪等性で再送を許容する。
- workerが`processing`中に停止した場合、lock timeout後に別workerが回収する。
- receipt待機timeout時はtx hashを保持し、同じtransactionを確認する。
- chain ID、contract bytecode、operatorが設定と不一致ならworker起動を停止する。
- canonical payloadへPII、画像、credentialを含めない。
- 同じoperator walletからのtransaction送信はMVP worker内で直列化する。

## Requirements

### Functional Requirements

- **FR-001**: 監査イベントとoutboxは同一DB transactionで作成しなければならない。
- **FR-002**: idempotency keyは一意で、同じ内容の再送だけを許可しなければならない。
- **FR-003**: payloadは決定的にcanonical化し、SHA-256を保存しなければならない。
- **FR-004**: chainへraw payloadまたはPIIを書き込んではならない。
- **FR-005**: worker claimは`FOR UPDATE SKIP LOCKED`で複数instance間を排他しなければならない。
- **FR-006**: RPC呼び出し中にDB transactionを保持してはならない。
- **FR-007**: transaction hash取得後はDBへ保存し、再試行時にreceipt確認を再開しなければならない。
- **FR-008**: retryはbackoffし、非retry errorと最大回数到達を`dead`へ移行しなければならない。
- **FR-009**: staleな`processing` jobをlock timeout後に再claimできなければならない。
- **FR-010**: worker起動時にchain ID、contract bytecode、operatorを検証しなければならない。
- **FR-011**: contractは同一event + 同一hashの再送を許容し、異なるhashを拒否しなければならない。
- **FR-012**: contractへの書き込みはoperatorだけに限定しなければならない。
- **FR-013**: 内部APIは機能flagと32文字以上のBearer tokenで保護しなければならない。
- **FR-014**: status APIは配送状態、tx hash、block number、error codeを返さなければならない。
- **FR-015**: Docker ComposeでPostgreSQL、Hardhat chain、deploy、backend、workerを再現できなければならない。
- **FR-016**: HTTP→DB→worker→contract→receiptのE2Eを自動検証できなければならない。

## Success Criteria

- **SC-001**: unit test、contract test、PostgreSQL統合テストがすべて成功する。
- **SC-002**: 2 workerの同時claim testで同一jobの取得件数合計が常に1になる。
- **SC-003**: E2Eで登録から45秒以内に`confirmed`へ到達する。
- **SC-004**: E2Eでcontract上のhashとDBのpayload hashが一致する。
- **SC-005**: backendのlint、typecheck、buildとDocker Compose config検証が成功する。

## Assumptions

- MVP chainはHardhat chain ID `31337`、本番候補はPolygonであり、本番networkは別途確定する。
- MVP contract addressとoperator keyはHardhatの決定的な開発値を使用する。
- 本機能はIssue #14 / PR #27のDB schemaへ依存し、同PRを先にmergeする。
- Cloud Tasks + OIDCは本番構成案とし、MVPはDB polling workerで配送保証を検証する。
