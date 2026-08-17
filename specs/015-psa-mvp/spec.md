# 機能仕様: PSA証明書照会MVP

**Feature Branch**: `feat/15-psa-mvp`

**Created**: 2026-08-13

**Status**: Implemented

**Input**: Issue #15「PSAのAPI調査、MVP実装」

## User Scenarios & Testing

### User Story 1 - PSA登録情報を確認する (Priority: P1)

出品者はPSAケースの証明書番号を入力し、PSAに登録されたカード名、グレード、個体数をTrustca上で確認する。

**Why this priority**: PSA鑑定済みカードの出品審査に必要な最小価値である。

**Independent Test**: モックPSA上流へ既知番号を登録し、画面から照会して登録情報が表示されることを確認する。

**Acceptance Scenarios**:

1. **Given** PSAにカード登録がある、**When** 同じ証明書番号を照会する、**Then** 「PSA登録情報確認済み」と許可されたカード情報を表示する。
2. **Given** PSAに登録がない、**When** 証明書番号を照会する、**Then** 未登録と表示して自動承認しない。

### User Story 2 - 曖昧な結果を安全に扱う (Priority: P2)

運営者は、上流の未知形式や番号不一致を誤って確認済みにせず、目視確認対象として扱える。

**Independent Test**: DNAのみ、番号不一致、未知JSONを入力し、すべて`in_review`になることを確認する。

**Acceptance Scenarios**:

1. **Given** カード情報として解釈できない応答、**When** 正規化する、**Then** 自動確認せず「自動確認できません」と表示する。
2. **Given** PSA APIが一時利用不能、**When** 照会する、**Then** 503と再試行可能な案内を返す。

### User Story 3 - PSA API利用量を抑える (Priority: P3)

運営者は同じ番号への重複照会を減らし、外部APIの利用枠を無駄にしない。

**Independent Test**: 同じ番号を連続・同時に照会し、外部呼び出しが1回になることを確認する。

**Acceptance Scenarios**:

1. **Given** 有効なキャッシュがある、**When** 同じ番号を再照会する、**Then** PSAへ接続せずキャッシュ結果を返す。
2. **Given** 送信元が分間上限を超えた、**When** 追加照会する、**Then** 429を返す。

### Edge Cases

- 空値、全角数字、記号、33桁以上はbackendで拒否する。
- HTTP 500はPSA公式資料上、資格情報不備とサーバー障害の双方があり得るため、1回再試行後も成功しなければ承認しない。
- `PSACert.CertNumber`が要求番号と違う場合は`in_review`にする。
- `DNACert`しかない場合はカード確認済みにしない。

## Requirements

### Functional Requirements

- **FR-001**: backendはPSA証明書番号を1〜32桁の半角数字として検証しなければならない。
- **FR-002**: PSAトークンはbackendだけが保持し、frontendへ公開してはならない。
- **FR-003**: PSA応答は`verified`、`not_found`、`invalid_request`、`in_review`へ正規化しなければならない。
- **FR-004**: 未知または矛盾する応答を`verified`にしてはならない。
- **FR-005**: 一時障害は最大1回再試行し、失敗時は503にしなければならない。
- **FR-006**: 確定結果を24時間キャッシュし、同時照会を集約しなければならない。
- **FR-007**: frontendはbackendを直接呼び、Server ActionまたはNext.js API Routeを追加してはならない。
- **FR-008**: UIは登録情報照会が現物の真正性保証ではない旨を表示しなければならない。

### Key Entities

- **PsaVerification**: 要求番号、正規化状態、照会時刻、有効期限、出典、キャッシュ利用有無を持つ照会結果。
- **PsaCard**: PSAから取得し許可リストで限定したカード登録情報。

## Success Criteria

- **SC-001**: 既知の正常・未登録・不正・曖昧レスポンスを100%期待状態へ正規化する。
- **SC-002**: 5秒以内に応答しない上流を打ち切り、再試行後に安全なエラーを返す。
- **SC-003**: 同一番号の有効期限内の連続照会と同時照会を外部1リクエストへ抑える。
- **SC-004**: モバイルとデスクトップの双方で入力、結果、注意事項を欠落なく確認できる。

## Assumptions

- PSA Public APIトークンはプロジェクト管理者が別途取得する。
- Cloud SQL永続化、認証認可、分散レート制限は本MVPの次段階とする。
- PSA登録情報との一致は出品審査材料の1つであり、単独で販売許可を決定しない。
