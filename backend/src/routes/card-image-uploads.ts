import { Hono } from "hono";
import type { PaymentConfig, VisionConfig } from "../env.js";
import { sessionFromAuthorization } from "../services/session-token.js";
import {
  issueUploadUrl,
  type UploadContentType,
} from "../services/storage.js";

type Dependencies = {
  visionConfig: VisionConfig;
  paymentConfig: PaymentConfig;
};

const ALLOWED_CONTENT_TYPES: UploadContentType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createCardImageUploadsRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/uploads/card-images", async (c) => {
    if (!dependencies.visionConfig.enabled) {
      return c.json(
        {
          error: {
            code: "VISION_MVP_DISABLED",
            message: "カード画像チェック機能は現在無効です。",
          },
        },
        503,
      );
    }

    const session = await sessionFromAuthorization(
      c.req.header("authorization"),
      dependencies.paymentConfig,
    );
    if (!session) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "認証が必要です。" } },
        401,
      );
    }

    const body: unknown = await c.req.json().catch(() => null);
    const contentType =
      isRecord(body) && typeof body.contentType === "string"
        ? body.contentType
        : "";

    if (!ALLOWED_CONTENT_TYPES.includes(contentType as UploadContentType)) {
      return c.json(
        {
          error: {
            code: "INVALID_CONTENT_TYPE",
            message: "content typeはimage/jpeg・image/png・image/webpのいずれかを指定してください。",
          },
        },
        400,
      );
    }

    const { objectKey, uploadUrl } = await issueUploadUrl({
      bucket: dependencies.visionConfig.storageBucket,
      contentType: contentType as UploadContentType,
      ttlSeconds: dependencies.visionConfig.uploadUrlTtlSeconds,
    });

    return c.json(
      {
        data: {
          objectKey,
          uploadUrl,
          bucket: dependencies.visionConfig.storageBucket,
        },
      },
      200,
    );
  });

  return route;
}
