import { Hono } from "hono";
import type { Pool } from "pg";
import {
  attachLatestPsaVerification,
  CertNumberAlreadyUsedError,
  createCard,
} from "../db/cards.js";
import { getSellerById } from "../db/sellers.js";
import type { PaymentConfig } from "../env.js";
import {
  resolveWalletSession,
  UNAUTHORIZED_RESPONSE,
} from "../middleware/wallet-session.js";

type Dependencies = {
  pool: Pool;
  walletConfig: PaymentConfig;
};

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
