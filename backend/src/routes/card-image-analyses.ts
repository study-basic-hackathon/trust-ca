import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import { getCardById, getCardImageById } from "../db/card-images.js";
import {
  getCardImageAnalysisById,
  insertCardImageAnalysis,
  listCardImageAnalysesForAdmin,
  type AnalysisResult,
  type CardImageAnalysisRecord,
  type CardImageAnalysisStatus,
} from "../db/card-image-analyses.js";
import type { PaymentConfig, VisionConfig } from "../env.js";
import { evaluateContentMatch } from "../services/card-image-analysis.js";
import { sessionFromAuthorization } from "../services/session-token.js";
import { VisionServiceError, type VisionAnnotationService } from "../services/vision.js";

type Dependencies = {
  pool: Pool;
  visionConfig: VisionConfig;
  paymentConfig: PaymentConfig;
  visionService: Pick<VisionAnnotationService, "annotate">;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANALYSIS_STATUS_VALUES: CardImageAnalysisStatus[] = [
  "pending",
  "processing",
  "completed",
  "in_review",
  "failed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toResponse(record: CardImageAnalysisRecord) {
  return {
    id: record.id,
    cardId: record.cardId,
    sourceImageId: record.sourceImageId,
    analysisKind: record.analysisKind,
    provider: record.provider,
    status: record.status,
    score: record.score,
    normalizedResult: record.normalizedResult,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function failureResult(message: string): AnalysisResult {
  return {
    ocrText: "",
    matchedName: false,
    matchedCardNumber: null,
    cardLikeLabelDetected: false,
    labels: [],
    objectBoundingBoxes: [],
    failureReason: message,
  };
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function isAdminAuthorized(header: string | undefined, expectedToken: string): boolean {
  if (!expectedToken) return false;
  if (!header?.startsWith("Bearer ")) return false;
  return secureEqual(header.slice(7), expectedToken);
}

export function createCardImageAnalysesRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/card-image-analyses", async (c) => {
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
    const cardId = isRecord(body) && typeof body.cardId === "string" ? body.cardId : "";
    const imageId = isRecord(body) && typeof body.imageId === "string" ? body.imageId : "";
    if (!UUID_PATTERN.test(cardId) || !UUID_PATTERN.test(imageId)) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST_BODY",
            message: "有効なcardIdとimageIdを指定してください。",
          },
        },
        400,
      );
    }

    const card = await getCardById(dependencies.pool, cardId);
    if (!card) {
      return c.json(
        { error: { code: "CARD_NOT_FOUND", message: "指定されたカードが見つかりません。" } },
        404,
      );
    }

    const image = await getCardImageById(dependencies.pool, imageId);
    if (!image || image.cardId !== cardId) {
      return c.json(
        {
          error: {
            code: "IMAGE_NOT_FOUND",
            message: "指定された画像が見つかりません。",
          },
        },
        404,
      );
    }

    let status: CardImageAnalysisStatus;
    let score: number | null;
    let normalizedResult: AnalysisResult;

    try {
      const annotation = await dependencies.visionService.annotate({
        bucket: image.storageBucket,
        objectKey: image.storageObject,
      });
      const evaluation = evaluateContentMatch({
        ocrText: annotation.ocrText,
        labels: annotation.labels,
        objectBoundingBoxes: annotation.objectBoundingBoxes,
        declaredName: card.name,
        declaredCardNumber: card.cardNumber,
      });
      status = evaluation.status;
      score = evaluation.score;
      normalizedResult = evaluation.normalizedResult;
    } catch (error) {
      const code =
        error instanceof VisionServiceError ? error.code : "VISION_ANALYSIS_ERROR";
      console.error("Vision API解析に失敗しました:", code);
      status = "failed";
      score = null;
      normalizedResult = failureResult(
        "Vision APIの解析に失敗しました。運営者による確認が必要です。",
      );
    }

    const analysis = await insertCardImageAnalysis(dependencies.pool, {
      cardId,
      sourceImageId: imageId,
      status,
      score,
      normalizedResult,
    });

    return c.json({ data: toResponse(analysis) }, 201);
  });

  route.get("/api/v1/card-image-analyses/:analysisId", async (c) => {
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

    const analysis = await getCardImageAnalysisById(
      dependencies.pool,
      c.req.param("analysisId"),
    );
    if (!analysis) {
      return c.json(
        {
          error: {
            code: "ANALYSIS_NOT_FOUND",
            message: "指定された解析結果が見つかりません。",
          },
        },
        404,
      );
    }

    return c.json({ data: toResponse(analysis) });
  });

  route.get("/api/v1/admin/card-image-analyses", async (c) => {
    if (!isAdminAuthorized(c.req.header("authorization"), dependencies.visionConfig.adminToken)) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "内部トークンが必要です。" } },
        401,
      );
    }

    const statusParam = c.req.query("status");
    if (
      statusParam !== undefined &&
      !ANALYSIS_STATUS_VALUES.includes(statusParam as CardImageAnalysisStatus)
    ) {
      return c.json(
        { error: { code: "INVALID_STATUS", message: "statusの値が不正です。" } },
        400,
      );
    }

    const rows = await listCardImageAnalysesForAdmin(dependencies.pool, {
      status: statusParam as CardImageAnalysisStatus | undefined,
    });

    return c.json({
      data: rows.map((row) => ({
        ...toResponse(row),
        card: {
          name: row.cardName,
          series: row.cardSeries,
          cardNumber: row.cardNumber,
        },
        image: {
          storageBucket: row.storageBucket,
          storageObject: row.storageObject,
        },
      })),
    });
  });

  return route;
}
