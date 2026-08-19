# Quickstart: Vision APIによるカード画像コンテンツチェックMVP

## 1. 前提: 検証用の`cards`行

本機能はカード個体の作成機能に依存しない(research.md §7)ため、検証用に直接1行INSERTする。

```sql
INSERT INTO cards (id, current_owner_id, name, series, card_number, status)
VALUES ('00000000-0000-0000-0000-000000000001',
        '<既存のuser id>',
        'リザードンex', 'SV1a', '006/070', 'draft');
```

## 2. 環境変数

```bash
cp .env.example .env
```

```dotenv
VISION_MVP_ENABLED=true
VISION_STORAGE_BUCKET=<非公開GCSバケット名>
GOOGLE_APPLICATION_CREDENTIALS=<ローカルではADCキーのパス。Cloud Runでは不要>
```

## 3. 起動

```bash
docker compose up --build
```

## 4. アップロードURL発行 → アップロード → 画像登録

```bash
# 1. 署名付きアップロードURLを発行
curl -X POST http://localhost:8080/api/v1/uploads/card-images \
  -H 'Authorization: Bearer <wallet session token>' \
  -H 'Content-Type: application/json' \
  -d '{"contentType":"image/jpeg"}'

# 2. 返却されたuploadUrlへ画像バイナリをPUT(署名付きURLなので追加ヘッダ不要)
curl -X PUT "<uploadUrl>" -H 'Content-Type: image/jpeg' --data-binary @corner.jpg

# 3. アップロード完了をbackendへ登録
curl -X POST http://localhost:8080/api/v1/cards/00000000-0000-0000-0000-000000000001/images \
  -H 'Authorization: Bearer <wallet session token>' \
  -H 'Content-Type: application/json' \
  -d '{"objectKey":"<1で返却されたobjectKey>","contentType":"image/jpeg","byteSize":123456,"sha256":"<sha256>","imageKind":"corner_top_left"}'
```

## 5. 内容整合性チェックの実行

到着後画像(購入者がアップロードした`imageId`)を対象に解析を実行する。

```bash
curl -X POST http://localhost:8080/api/v1/card-image-analyses \
  -H 'Authorization: Bearer <buyer wallet session token>' \
  -H 'Content-Type: application/json' \
  -d '{"cardId":"00000000-0000-0000-0000-000000000001","imageId":"<到着後画像のid>"}'
```

期待される応答: `status`が`completed`(内容整合)または`in_review`/`failed`(要確認)。`normalized_result`にOCRテキスト・ラベル・判定根拠が含まれる(data-model.md参照)。

## 6. 検証コマンド

```bash
cd backend
pnpm lint
pnpm typecheck
pnpm test
pnpm build

cd ../frontend
pnpm lint
pnpm build
```

Vision APIはテスト内でモックする(PSA MVPの`psa-service.test.ts`と同じ方針)ため、実際のGCP認証情報なしで`pnpm test`を実行できる。

## 7. 注意

- `内容整合`表示は現物の真正性・個体の同一性を保証しない。精巧な偽造品(印字内容が本物と同一)は検出できない旨をUIに明記する(FR-010)。
- 物理的な同一個体照合(`analysis_kind = 'image_comparison'`)は本MVPでは未実装。別タスクとして扱う(FR-012)。
- 公開環境では`VISION_MVP_ENABLED=false`を維持し、Cloud Storageバケットのライフサイクル・IAM設定完了後に有効化する。
