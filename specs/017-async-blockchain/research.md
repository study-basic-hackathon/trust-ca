# Research: 取引情報の非同期オンチェーン記録

## 1. 配送保証

**Decision**: PostgreSQL transactional outboxを配送の正本にする。

**Rationale**: 業務更新とjob作成を同じtransactionでcommitでき、process停止やchain障害でも未処理jobをDBから回収できる。

**Alternatives considered**:

- 業務commit後のfire-and-forget: commitとenqueueの間に停止すると配送漏れになる。
- browser `localStorage`: browser終了、storage削除、別端末で保証を失う。
- chainを先に確定: RPC遅延・障害が購入等の主要業務を停止させる。

## 2. Worker claim

**Decision**: PostgreSQLの`FOR UPDATE SKIP LOCKED`をCTE + `UPDATE RETURNING`で使う。

**Rationale**: queue consumer向けの排他取得を追加サービスなしで実装でき、RPC中にrow lockを保持せずに済む。

## 3. EVM client

**Decision**: backendとtestでviemを使用する。

**Rationale**: typed ABI、`simulateContract`、wallet/public clientの責務分離、receipt待機を小さい構成で扱える。Node-Stayのethers構成からprovider/signerの考え方を移行しつつ、Trustcaではviemへ統一する。

## 4. Contract toolchain

**Decision**: Hardhat 3 + Node test runner + viem toolboxを使用する。

**Rationale**: TypeScript/Node.js 24のrepository構成に合い、local JSON-RPC node、deploy script、Solidity testを同じpackageで実行できる。

## 5. オンチェーンデータ

**Decision**: UUID由来event key、SHA-256 payload hash、発生時刻だけを保存する。

**Rationale**: 改竄検知に必要な最小情報を残し、PIIやprovider raw payloadを公開chainへ置かない。UUID文字列そのものも保存せず`keccak256`で固定長keyにする。

## 6. 冪等性

**Decision**: API、DB、contractの3層で冪等性を持つ。

- API/DB: idempotency key + event metadata + payload hash + occurredAtを比較
- outbox: audit event IDをprimary keyにして1対1
- contract: 同一event + 同一hashはno-op、異なるhashはrevert

**Rationale**: transaction送信後・DB保存前の停止を含む曖昧なfailure windowを安全に再実行できる。

## 7. 本番task起動

**Decision**: 本番候補はCloud Tasks HTTP target + OIDC。ただしoutboxを正本としてdispatcherが未enqueue jobを再scanする。

**Rationale**: rate controlとCloud Run起動に向く。task作成自体をDB transactionへ含められないため、定期dispatcherでenqueue gapを回収する必要がある。

## 8. 参考資料

- [Hardhat 3 Getting Started](https://hardhat.org/docs/getting-started)
- [Hardhat 3: Testing with viem](https://hardhat.org/docs/guides/testing/using-viem)
- [viem: writeContract](https://viem.sh/docs/contract/writeContract)
- [Cloud Tasks: Create HTTP target tasks](https://cloud.google.com/tasks/docs/creating-http-target-tasks)
- [PostgreSQL: Locking Clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
