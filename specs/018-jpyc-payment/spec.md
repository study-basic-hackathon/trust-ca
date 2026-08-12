# Feature Specification: JPYC決済MVP

**Issue**: [#18 仮想通貨での取引き](https://github.com/study-basic-hackathon/trust-ca/issues/18)

**作成日**: 2026-08-13

**状態**: MVP実装済み

## 1. User Story

### US-1: WalletでTrustcaへ署名ログインする（P1）

購入者はEmbedded Walletsまたは外部walletを接続し、Trustcaが発行したSIWE messageへ署名して、支払操作用の短時間sessionを取得できる。

**受入条件**

- challengeは使い捨てで、期限切れ・再利用・field改変を拒否する。
- sessionは署名wallet addressとchain IDへboundされる。
- clientのlogin結果だけでは認証済みにならない。

### US-2: 注文に固定されたJPYCを送金する（P1）

購入者は注文IDから支払額、受取先、token contractを取得し、内容を確認してJPYCを送金できる。

**受入条件**

- buyer以外はintentを作成できない。
- order/listingの状態、通貨、payer/payee walletを検証する。
- 同じ条件の再送は同じintentを返す。
- 金額はinteger/stringで扱い、floating pointを使用しない。

### US-3: Chain上の根拠で支払状態を確定する（P1）

システムはbrowserが返すtx hashを一旦`submitted`として受け付け、非同期workerがchain上の内容を確認してから取引をpaidへ更新する。

**受入条件**

- receipt successだけでなくfrom、token、function、recipient、amount、Transfer eventを照合する。
- confirmation不足とRPC一時障害は再試行する。
- 一致時はpayment/order/listingを1 transactionで更新する。
- tx hashは同じchainで再利用できない。

## 2. 非機能要件

- Cloud Run複数instanceでchallengeとworker claimが競合しない。
- wallet秘密鍵・seed phraseを保存しない。
- PII、session、signatureをlogへ出さない。
- local Docker ComposeだけでSIWE→送金→DB確定のE2Eを再現できる。
- UI、document、comment、運用messageは自然な日本語とする。

## 3. 対象外

- エスクロー、自動返金、代理送金
- mainnet実資金運用
- EIP-1271
- JPYC EX発行・償還
- disputeと配送完了

## 4. Success Criteria

1. unit test、typecheck、lint、production buildが成功する。
2. migrationを空schemaへ適用し、再実行・同時実行・checksum検知が成功する。
3. local chain E2Eで12,000 JPYCのtransferが確認され、DB状態が`confirmed/paid/sold`になる。
4. 不正な送信先・金額・送信元・token・revertはpaidにならない設計とtestがある。
