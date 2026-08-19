# Research: 販売者登録フロー実装

## 1. 本人確認API呼び出しの認可

**Decision**: MVPでは`POST /api/v1/sellers`をログイン必須にせず、`poc/ekyc/`と同様に表示名だけで販売者アカウントを作成し、発行された`sellerId`をクライアント側が保持する運用を踏襲する。`kyc-sessions`作成・`verification`取得のルートは、`Authorization`ヘッダーが付与されていれば既存のwallet session(`backend/src/services/session-token.ts`の`sessionFromAuthorization`)を検証してuserIdと`sellerId`の一致を確認し、ヘッダーがなければ従来通り`sellerId`ベースで許可する、後方互換の構成にする。

**Rationale**: 完全なwallet認証必須化は「販売者登録前にウォレット接続を必須にするか」という画面フロー全体の意思決定を伴い、スコープが本Issueの範囲を超える。`docs/design/api-catalog.md` §6.3の認可欄(「ログインユーザー」「本人」)は目標状態であり、厳密な実装まで本Issueで確定させる必要はないとspec.mdのAssumptionsで明記済み。既存のIssue #18実装(`wallet-auth`/`session-token`)を壊さず、将来の統合コストだけを下げておく。

**Alternatives considered**:

- 完全なwallet session必須化: フロントエンドのウォレット接続フロー変更が本Issueに追加され、スコープが大きく膨らむため却下。
- `poc/ekyc/`と完全に同一(認可なし)のまま: 将来Issueでの統合コストを先送りしすぎるため、Authorizationヘッダーの任意受け入れという折衷案を採用。

## 2. 運営者向けAPIの認可

**Decision**: 環境変数`ADMIN_API_TOKEN`による共有シークレット方式。`admin-verifications`ルートにだけ、`Authorization: Bearer <ADMIN_API_TOKEN>`を検証するミドルウェアを適用する。

**Rationale**: [seller-onboarding-review-flow.md](../../docs/design/seller-onboarding-review-flow.md) §5.1が「本番のRBACは過剰。ブラウザから誰でも叩けないことだけ担保すれば足りる」と明記しており、本番相当のRBAC設計はハッカソンMVPのスコープでは過剰と判断済み。

**Alternatives considered**:

- Basic認証: ブラウザネイティブダイアログはデモ操作性が悪く、認可の強度もBearer tokenと同等のため採用しない。
- 認可なしで公開: FR-018(権限のない呼び出し元の拒否)を満たせず、eKYC信頼設計の原則(未知の呼び出し元を信用しない)にも反するため却下。

## 3. DBスキーマのギャップ確認

**Decision**: `seller_verifications`/`verification_events`の`source`列は既に`'created' | 'webhook' | 'poll' | 'operator'`をCHECK制約でサポートしており(0001行107-176)、運営者判断を追加するための列追加・制約変更は不要と確認した。`seller_verifications_one_active_per_seller_uq`(進行中セッション1件制限)、`seller_verifications_seller_created_idx`(販売者別の履歴検索)も既存のまま利用できる。ただし実装時に、Diditのセッション遷移先URLがセッション作成レスポンスにしか含まれず(`poc/ekyc/src/lib/didit/client.ts`の`getSessionDecision`はURLを返さない)、既存の進行中セッションを再開する画面(US2の受入条件2)のために保持先が必要なことが判明したため、`seller_verifications.session_url`(nullable text)を追加する`0003_seller_verification_session_url.sql`のみ新規migrationとして追加する。

**Rationale**: `session_url`はPIIでも秘密情報でもなく(`session_token`のような秘密値は含まない)、既存のPII最小化方針(FR-012)を損なわない。他のテーブル・列は当初の想定通り変更不要。

**Alternatives considered**: 運営者向けの「審査中」一覧クエリ専用に`seller_verifications(status)`のindexを新規追加する案は、MVP規模のデータ量では既存indexで十分と判断し、時期尚早な最適化として見送った。セッションURLを`checks`(jsonb)列へ間借りさせる案は、`checks`の意味(本人確認書類・生体・顔照合等の結果)をなし崩しに拡張してしまうため却下し、専用列を追加する方を選んだ。

## 4. Webhook署名検証ロジック

**Decision**: `poc/ekyc/src/lib/didit/signature.ts`の実装(V2署名→Simpleフォールバック→raw、HMAC-SHA256、`timingSafeEqual`、タイムスタンプ±300秒許容)を`backend/src/services/didit/signature.ts`へほぼそのまま移植する。

**Rationale**: [ekyc-design.md](../../docs/design/ekyc-design.md) §3.3・[api-catalog.md](../../docs/design/api-catalog.md) §5.2が、この検証順序と信頼境界を移植前提として明示している。実装済み・Diditとの実疎通で検証済みのロジックを再発明する理由がない。

**Alternatives considered**: V2署名のみをサポートし簡略化する案は、ローカル開発環境やDidit側のWebhook設定によってはSimple/rawへのフォールバックが必要になる既存の検証済み挙動を壊すため却下。

## 5. Diditクライアントの移植方針

**Decision**: `poc/ekyc/src/lib/didit/client.ts`の`createVerificationSession`/`getSessionDecision`/`DiditApiError`を`backend/src/services/didit/client.ts`へ移植する。`vendorData`にはPostgreSQLの`seller_id`(UUID文字列)を、`callbackUrl`には`frontend/src/app/sellers/callback/page.tsx`のURLを渡す。

**Rationale**: [system-architecture.md](../../docs/design/system-architecture.md) §4.2が、`poc/ekyc/src/lib/didit/*`はNode.js標準`fetch`ベースでフレームワーク非依存であり「移植コストは小さい」と評価済み。新規SDK・追加パッケージは不要。

**Alternatives considered**: 新規のDidit公式SDK等を調査・導入する案は、追加の依存関係とAPI変更リスクを持ち込むだけで、MVPスコープでの利点がないため見送る。

## 6. フロントエンドの画面構成

**Decision**: `frontend/src/app/sellers/register/page.tsx`(登録)、`frontend/src/app/sellers/[sellerId]/page.tsx`(本人確認開始・状態表示・5秒間隔ポーリング)、`frontend/src/app/sellers/callback/page.tsx`(Diditからの遷移先。信用せず状態再取得のトリガーとしてのみ扱う)、`frontend/src/app/admin/verifications/page.tsx`(運営者向け審査中一覧・決定操作)の4画面構成とする。

**Rationale**: `poc/ekyc/`の単一ページ構成(`page.tsx` + `callback/page.tsx` + `flow/page.tsx`)を、Next.js App Routerの規約(URLパス=ディレクトリ構造、[folder-structure.md](../../docs/design/folder-structure.md) §3.2)に沿って、販売者向けと運営者向けで責務分割したもの。`FlowStepper`/`EventTimeline`のような可視化コンポーネントの完全移植はspec.mdの通り必須要件に含めない。

**Alternatives considered**: 単一ページに販売者操作と運営者操作を同居させる案は、想定利用者・認可(sellerId vs 共有シークレット)が異なるため、実装・レビューのしやすさを優先して分離した。

## 7. 参考資料

- [Didit API Reference](https://docs.didit.me/api-reference/overview)
- [Didit Webhooks](https://docs.didit.me/integration/webhooks)
- [docs/design/ekyc-design.md](../../docs/design/ekyc-design.md)
- [docs/design/seller-onboarding-review-flow.md](../../docs/design/seller-onboarding-review-flow.md)
- [docs/design/api-catalog.md](../../docs/design/api-catalog.md) §6.3
- [docs/design/database-schema.md](../../docs/design/database-schema.md) §11
