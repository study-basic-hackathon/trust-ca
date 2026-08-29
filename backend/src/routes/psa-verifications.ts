import { Hono } from "hono";
import type { Pool } from "pg";
import { insertPsaVerification } from "../db/psa-verifications.js";
import type { PsaConfig } from "../env.js";
import type { FixedWindowRateLimiter } from "../middleware/rate-limit.js";
import {
  PsaServiceError,
  type PsaVerificationService,
} from "../services/psa.js";

type Dependencies = {
  config: PsaConfig;
  service: Pick<PsaVerificationService, "verify">;
  rateLimiter: FixedWindowRateLimiter;
  /** 未指定の場合は照会結果を永続化しない(テスト用) */
  pool?: Pool;
};

const CERT_NUMBER_PATTERN = /^\d{1,32}$/;

function requestKey(forwardedFor: string | undefined): string {
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export function createPsaVerificationRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/cards/psa-verifications", async (c) => {
    if (!dependencies.config.enabled) {
      return c.json(
        {
          error: {
            code: "PSA_MVP_DISABLED",
            message: "PSA照会機能は現在無効です。",
          },
        },
        503,
      );
    }

    // モック有効時はトークン不要(実APIを呼ばないため)
    if (!dependencies.config.mockEnabled && !dependencies.config.apiToken) {
      return c.json(
        {
          error: {
            code: "PSA_API_CONFIGURATION_ERROR",
            message: "PSA照会機能の設定が完了していません。",
          },
        },
        503,
      );
    }

    const key = requestKey(c.req.header("x-forwarded-for"));
    if (!dependencies.rateLimiter.consume(key)) {
      c.header("Retry-After", "60");
      return c.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "照会回数の上限に達しました。時間をおいて再度お試しください。",
          },
        },
        429,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST_BODY",
            message: "JSON形式のリクエスト本文を指定してください。",
          },
        },
        400,
      );
    }

    const certNumber =
      typeof body === "object" &&
      body !== null &&
      "certNumber" in body &&
      typeof body.certNumber === "string"
        ? body.certNumber.trim()
        : "";

    if (!CERT_NUMBER_PATTERN.test(certNumber)) {
      return c.json(
        {
          error: {
            code: "INVALID_CERT_NUMBER",
            message: "証明書番号は1〜32桁の半角数字で入力してください。",
          },
        },
        400,
      );
    }

    try {
      const result = await dependencies.service.verify(certNumber);
      // 確定結果はDBへ永続化し、カード紐付け(latest_psa_verification_id)と
      // 監査履歴に使う(一時障害はserviceがthrowするため到達しない)。
      let verificationId: string | null = null;
      if (dependencies.pool) {
        verificationId = await insertPsaVerification(dependencies.pool, result);
      }
      return c.json({ data: { ...result, verificationId } }, 200);
    } catch (error) {
      const code =
        error instanceof PsaServiceError
          ? error.code
          : "PSA_API_UNAVAILABLE";
      console.error("PSA verification failed:", code);
      return c.json(
        {
          error: {
            code,
            message:
              "PSAの登録情報を確認できませんでした。時間をおいて再度お試しください。",
          },
        },
        503,
      );
    }
  });

  return route;
}
