# 調査結果: PSA証明書照会MVP

## Decision 1: PSA公式の単一証明書照会を利用する

- **Decision**: `GET /publicapi/cert/GetByCertNumber/{certNumber}`を利用する。
- **Rationale**: 出品者が入力できる値が証明書番号であり、カード情報を取得する最小の公式経路である。
- **Alternatives rejected**: PSA証明書ページのスクレイピングは利用規約・画面変更・レート制限に弱いため採用しない。

## Decision 2: 公式モデルをそのまま公開しない

- **Decision**: 必要フィールドだけをTrustca形式へ正規化する。
- **Rationale**: 上流の追加・変更をfrontendへ伝播させず、未知の状態を承認扱いにしないため。
- **Alternatives rejected**: JSONの透過転送は秘密・不要データ・破壊的変更の影響範囲を広げる。

## Decision 3: MVPはメモリキャッシュを使う

- **Decision**: 確定結果を24時間メモリキャッシュし、同時要求を集約する。
- **Rationale**: Issue #14のDBスキーマPRから独立して動作し、外部呼び出しを削減できる。
- **Alternatives rejected**: DB永続化を同じPRへ持ち込むと独立性が失われる。無キャッシュはAPI利用量を増やす。

## Decision 4: 現物の真正性は保証しない

- **Decision**: `verified`は証明書番号とPSA登録情報の一致だけを表す。
- **Rationale**: PSA公式も証明書照会だけでは現物の真正性を保証できないと注意している。
- **Alternatives rejected**: 「本物確認済み」の表示はPSAケース・画像・現物のすり替えを見落とす。

## Primary Sources

- [PSA Public API Documentation](https://www.psacard.com/publicapi/documentation)
- [PSA Public API Swagger](https://api.psacard.com/publicapi/swagger.json)
- [PSA Certification Verification](https://www.psacard.com/cert/)
