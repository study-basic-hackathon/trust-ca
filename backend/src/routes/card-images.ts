import { Hono } from "hono";
import type { Pool } from "pg";
import {
  CardImageConflictError,
  getCardById,
  insertCardImage,
  type CardImageKind,
} from "../db/card-images.js";
import { consumePossessionChallenge } from "../db/possession.js";
import type { PaymentConfig, VisionConfig } from "../env.js";
import { sessionFromAuthorization } from "../services/session-token.js";
import {
  StorageServiceError,
  verifyUploadedObject,
  type UploadContentType,
} from "../services/storage.js";

type Dependencies = {
  pool: Pool;
  visionConfig: VisionConfig;
  paymentConfig: PaymentConfig;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_CONTENT_TYPES: UploadContentType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];
const ALLOWED_IMAGE_KINDS: CardImageKind[] = [
  "front",
  "back",
  "label",
  "corner_top_left",
  "corner_top_right",
  "corner_bottom_left",
  "corner_bottom_right",
  "possession",
];
const ALLOWED_UPLOAD_CONTEXTS = ["listing", "arrival"] as const;
const MAX_BYTE_SIZE = 20 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 503) {
  return { body: { error: { code, message } }, status };
}

export function createCardImagesRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/cards/:cardId/images", async (c) => {
    if (!dependencies.visionConfig.enabled) {
      const { body, status } = errorResponse(
        "VISION_MVP_DISABLED",
        "カード画像チェック機能は現在無効です。",
        503,
      );
      return c.json(body, status);
    }

    const session = await sessionFromAuthorization(
      c.req.header("authorization"),
      dependencies.paymentConfig,
    );
    if (!session) {
      const { body, status } = errorResponse("UNAUTHORIZED", "認証が必要です。", 401);
      return c.json(body, status);
    }

    const cardId = c.req.param("cardId");
    if (!UUID_PATTERN.test(cardId)) {
      const { body, status } = errorResponse(
        "INVALID_CARD_ID",
        "cardIdの形式が不正です。",
        400,
      );
      return c.json(body, status);
    }

    const requestBody: unknown = await c.req.json().catch(() => null);
    if (!isRecord(requestBody)) {
      const { body, status } = errorResponse(
        "INVALID_REQUEST_BODY",
        "JSON形式のリクエスト本文を指定してください。",
        400,
      );
      return c.json(body, status);
    }

    const objectKey =
      typeof requestBody.objectKey === "string" ? requestBody.objectKey.trim() : "";
    if (!objectKey) {
      const { body, status } = errorResponse(
        "INVALID_OBJECT_KEY",
        "objectKeyを指定してください。",
        400,
      );
      return c.json(body, status);
    }

    const contentType = requestBody.contentType;
    if (!ALLOWED_CONTENT_TYPES.includes(contentType as UploadContentType)) {
      const { body, status } = errorResponse(
        "INVALID_CONTENT_TYPE",
        "content typeはimage/jpeg・image/png・image/webpのいずれかを指定してください。",
        400,
      );
      return c.json(body, status);
    }

    const byteSize = requestBody.byteSize;
    if (
      typeof byteSize !== "number" ||
      !Number.isSafeInteger(byteSize) ||
      byteSize <= 0 ||
      byteSize > MAX_BYTE_SIZE
    ) {
      const { body, status } = errorResponse(
        "INVALID_BYTE_SIZE",
        `byteSizeは1〜${MAX_BYTE_SIZE}の整数で指定してください。`,
        400,
      );
      return c.json(body, status);
    }

    const sha256 =
      typeof requestBody.sha256 === "string" ? requestBody.sha256.toLowerCase() : "";
    if (!SHA256_PATTERN.test(sha256)) {
      const { body, status } = errorResponse(
        "INVALID_SHA256",
        "sha256は64桁の16進数で指定してください。",
        400,
      );
      return c.json(body, status);
    }

    const imageKind = requestBody.imageKind;
    if (!ALLOWED_IMAGE_KINDS.includes(imageKind as CardImageKind)) {
      const { body, status } = errorResponse(
        "INVALID_IMAGE_KIND",
        "imageKindが不正です。",
        400,
      );
      return c.json(body, status);
    }

    const uploadContext = requestBody.uploadContext;
    if (
      !ALLOWED_UPLOAD_CONTEXTS.includes(
        uploadContext as (typeof ALLOWED_UPLOAD_CONTEXTS)[number],
      )
    ) {
      const { body, status } = errorResponse(
        "INVALID_UPLOAD_CONTEXT",
        "uploadContextはlistingまたはarrivalを指定してください。",
        400,
      );
      return c.json(body, status);
    }

    // 所持証明画像は有効な確認コード(captureNonce)を必須とする(screen-design.md §6.1)
    let captureNonce: string | null = null;
    if (imageKind === "possession") {
      captureNonce =
        typeof requestBody.captureNonce === "string"
          ? requestBody.captureNonce.trim().toUpperCase()
          : "";
      if (!captureNonce) {
        const { body, status } = errorResponse(
          "POSSESSION_NONCE_REQUIRED",
          "所持証明には確認コードが必要です。",
          400,
        );
        return c.json(body, status);
      }
      const consumed = await consumePossessionChallenge(dependencies.pool, {
        cardId,
        code: captureNonce,
      });
      if (!consumed) {
        const { body, status } = errorResponse(
          "POSSESSION_NONCE_INVALID",
          "確認コードが無効または期限切れです。コードを再発行してください。",
          400,
        );
        return c.json(body, status);
      }
    }

    const card = await getCardById(dependencies.pool, cardId);
    if (!card) {
      const { body, status } = errorResponse(
        "CARD_NOT_FOUND",
        "指定されたカードが見つかりません。",
        404,
      );
      return c.json(body, status);
    }

    // 出品時アップロードは出品者本人(cards.current_owner_id)のみ許可する。
    // 到着後アップロードは購入者を識別する仕組み(orders連携)が別機能のため、
    // MVPでは認証済みユーザーであれば許可する(research.md §7)。
    if (uploadContext === "listing" && session.userId !== card.currentOwnerId) {
      const { body, status } = errorResponse(
        "FORBIDDEN",
        "出品時画像は出品者本人のみアップロードできます。",
        403,
      );
      return c.json(body, status);
    }

    try {
      await verifyUploadedObject({
        bucket: dependencies.visionConfig.storageBucket,
        objectKey,
        expectedContentType: contentType as string,
        expectedByteSize: byteSize,
        expectedSha256: sha256,
      });
    } catch (error) {
      if (error instanceof StorageServiceError) {
        const { body, status } = errorResponse(error.code, error.message, 422);
        return c.json(body, status);
      }
      throw error;
    }

    try {
      const image = await insertCardImage(dependencies.pool, {
        cardId,
        uploadedByUserId: session.userId,
        imageKind: imageKind as CardImageKind,
        storageBucket: dependencies.visionConfig.storageBucket,
        storageObject: objectKey,
        contentType: contentType as string,
        byteSize,
        sha256,
      captureNonce,
      });
      return c.json(
        {
          data: {
            id: image.id,
            cardId: image.cardId,
            uploadedByUserId: image.uploadedByUserId,
            imageKind: image.imageKind,
            contentType: image.contentType,
            byteSize: image.byteSize,
            sha256: image.sha256,
            createdAt: image.createdAt.toISOString(),
          },
        },
        201,
      );
    } catch (error) {
      if (error instanceof CardImageConflictError) {
        const { body, status } = errorResponse(
          "CARD_IMAGE_CONFLICT",
          error.message,
          409,
        );
        return c.json(body, status);
      }
      throw error;
    }
  });

  return route;
}
