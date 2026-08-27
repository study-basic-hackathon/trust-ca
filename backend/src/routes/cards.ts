import { Hono } from "hono";
import type { Pool } from "pg";
import {
  attachLatestPsaVerification,
  CertNumberAlreadyUsedError,
  createCard,
  discardCard,
  getCardDetailById,
  listCardDraftsByOwner,
} from "../db/cards.js";
import {
  listCardImagesByCard,
  listPrimaryImagesByCards,
} from "../db/card-images.js";
import {
  createPossessionChallenge,
  hasPossessionProof,
} from "../db/possession.js";
import { getSellerById } from "../db/sellers.js";
import type { PaymentConfig } from "../env.js";
import {
  resolveWalletSession,
  UNAUTHORIZED_RESPONSE,
} from "../middleware/wallet-session.js";
import { issueDownloadUrl } from "../services/storage.js";

type Dependencies = {
  pool: Pool;
  walletConfig: PaymentConfig;
};

const IMAGE_URL_TTL_SECONDS = 15 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * 出品ウィザードStep1: カード個体の登録。
 * eKYC承認済み販売者のみが自分のカードとして作成できる。
 */
export function createCardsRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/cards", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const seller = await getSellerById(dependencies.pool, session.userId);
    if (!seller || seller.onboardingStatus !== "approved") {
      return c.json(
        {
          error: {
            code: "SELLER_NOT_APPROVED",
            message: "カード登録には本人確認(eKYC)の承認が必要です。",
          },
        },
        403,
      );
    }

    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body)) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST_BODY",
            message: "リクエスト本文を読み取れません。",
          },
        },
        400,
      );
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 255) {
      return c.json(
        {
          error: {
            code: "INVALID_CARD_NAME",
            message: "カード名は1〜255文字で入力してください。",
          },
        },
        400,
      );
    }
    const psaCertNumber =
      typeof body.psaCertNumber === "string" && body.psaCertNumber.trim()
        ? body.psaCertNumber.trim()
        : null;
    if (psaCertNumber && !/^[0-9]{1,32}$/.test(psaCertNumber)) {
      return c.json(
        {
          error: {
            code: "INVALID_CERT_NUMBER",
            message: "PSA証明書番号は1〜32桁の数字で入力してください。",
          },
        },
        400,
      );
    }

    try {
      const card = await createCard(dependencies.pool, {
        ownerId: session.userId,
        name,
        series: optionalText(body.series, 255),
        cardNumber: optionalText(body.cardNumber, 64),
        grade: optionalText(body.grade, 64),
        psaCertNumber,
      });
      return c.json({ data: card }, 201);
    } catch (error) {
      if (error instanceof CertNumberAlreadyUsedError) {
        return c.json(
          {
            error: { code: "CERT_NUMBER_ALREADY_USED", message: error.message },
          },
          409,
        );
      }
      throw error;
    }
  });

  // 出品ウィザードStep2.5: 所持証明用の確認コードを発行する
  route.post("/api/v1/cards/:cardId/possession-challenges", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const card = await getCardDetailById(
      dependencies.pool,
      c.req.param("cardId"),
    );
    if (!card || card.currentOwnerId !== session.userId) {
      return c.json(
        {
          error: {
            code: "CARD_NOT_FOUND",
            message: "カードが見つかりません。",
          },
        },
        404,
      );
    }
    const challenge = await createPossessionChallenge(
      dependencies.pool,
      card.id,
    );
    return c.json(
      {
        data: {
          code: challenge.code,
          expiresAt: challenge.expiresAt.toISOString(),
        },
      },
      201,
    );
  });

  // 出品ウィザードの途中離脱・再開: まだ出品(listings)に至っていない自分のカード一覧
  route.get("/api/v1/cards/mine", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const drafts = await listCardDraftsByOwner(dependencies.pool, session.userId);
    const primaryImages = await listPrimaryImagesByCards(
      dependencies.pool,
      drafts.map((card) => card.id),
    );
    const thumbnailUrls = new Map<string, string | null>(
      await Promise.all(
        primaryImages.map(
          async (image): Promise<[string, string | null]> => [
            image.cardId,
            await issueDownloadUrl({
              bucket: image.storageBucket,
              objectKey: image.storageObject,
              ttlSeconds: IMAGE_URL_TTL_SECONDS,
            }).catch(() => null),
          ],
        ),
      ),
    );
    return c.json({
      data: {
        items: drafts.map((card) => ({
          ...card,
          createdAt: card.createdAt.toISOString(),
          thumbnailUrl: thumbnailUrls.get(card.id) ?? null,
        })),
      },
    });
  });

  // 出品ウィザードの再開: 保存済みのカード情報・画像・所持確認状況をまとめて返す
  route.get("/api/v1/cards/:cardId", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const card = await getCardDetailById(dependencies.pool, c.req.param("cardId"));
    if (!card || card.currentOwnerId !== session.userId) {
      return c.json(
        {
          error: {
            code: "CARD_NOT_FOUND",
            message: "カードが見つかりません。",
          },
        },
        404,
      );
    }
    const images = await listCardImagesByCard(dependencies.pool, card.id);
    const imageViews = await Promise.all(
      images.map(async (image) => ({
        id: image.id,
        cardId: image.cardId,
        uploadedByUserId: image.uploadedByUserId,
        imageKind: image.imageKind,
        contentType: image.contentType,
        byteSize: image.byteSize,
        sha256: image.sha256,
        createdAt: image.createdAt.toISOString(),
        url: await issueDownloadUrl({
          bucket: image.storageBucket,
          objectKey: image.storageObject,
          ttlSeconds: IMAGE_URL_TTL_SECONDS,
        }).catch(() => null),
      })),
    );
    const possessionProof = await hasPossessionProof(dependencies.pool, card.id);
    return c.json({
      data: {
        card: { ...card, createdAt: card.createdAt.toISOString() },
        images: imageViews,
        hasPossessionProof: possessionProof,
      },
    });
  });

  // 出品ウィザードの破棄: まだ出品していないカードをarchived扱いにし、一覧から外す
  route.post("/api/v1/cards/:cardId/discard", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const discarded = await discardCard(dependencies.pool, {
      cardId: c.req.param("cardId"),
      ownerId: session.userId,
    });
    if (!discarded) {
      return c.json(
        {
          error: {
            code: "CARD_DISCARD_CONFLICT",
            message:
              "カードを破棄できません。既に出品済みか、見つかりません。",
          },
        },
        409,
      );
    }
    return c.json({ data: { discarded: true } });
  });

  // 出品ウィザードStep3(PSAあり): 照会結果をカードへ紐付ける
  route.post("/api/v1/cards/:cardId/psa-attachment", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const psaVerificationId =
      isRecord(body) && typeof body.psaVerificationId === "string"
        ? body.psaVerificationId
        : "";
    if (!psaVerificationId) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST_BODY",
            message: "psaVerificationIdを指定してください。",
          },
        },
        400,
      );
    }
    try {
      const attached = await attachLatestPsaVerification(dependencies.pool, {
        cardId: c.req.param("cardId"),
        ownerId: session.userId,
        psaVerificationId,
      });
      if (!attached) {
        return c.json(
          {
            error: {
              code: "CARD_NOT_FOUND",
              message: "カードが見つかりません。",
            },
          },
          404,
        );
      }
      return c.json({ data: { attached: true } });
    } catch (error) {
      // 異なるCert番号の照会結果は複合外部キーで拒否される
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "23503"
      ) {
        return c.json(
          {
            error: {
              code: "PSA_VERIFICATION_MISMATCH",
              message:
                "この照会結果はカードのPSA証明書番号と一致しません。",
            },
          },
          409,
        );
      }
      throw error;
    }
  });

  return route;
}
