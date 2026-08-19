import { Hono } from "hono";
import type { Pool } from "pg";
import { getSellerById } from "../db/sellers.js";
import type { DiditConfig, PaymentConfig } from "../env.js";
import { sessionFromAuthorization } from "../services/session-token.js";
import {
  DiditApiError,
  getVerificationStatus,
  startVerificationSession,
} from "../services/verifications.js";

type Dependencies = {
  pool: Pool;
  diditConfig: DiditConfig;
  walletConfig: PaymentConfig;
  frontendOrigin: string;
};

function toVerificationResponse(view: Awaited<
  ReturnType<typeof getVerificationStatus>
>) {
  return {
    verification: view.verification
      ? {
          sessionId: view.verification.providerSessionId,
          status: view.verification.status,
          checks: view.verification.checks,
          sessionUrl: view.verification.sessionUrl,
          requestedAt: view.verification.requestedAt.toISOString(),
          decidedAt: view.verification.decidedAt?.toISOString() ?? null,
        }
      : null,
    isSellingAllowed: view.isSellingAllowed,
    events: view.events.map((event) => ({
      eventType: event.eventType,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      source: event.source,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export function createKycRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.use("/api/v1/sellers/:sellerId/kyc-sessions", async (c, next) => {
    if (!dependencies.diditConfig.enabled) {
      return c.json(
        {
          error: {
            code: "DIDIT_MVP_DISABLED",
            message: "本人確認機能は現在無効です。",
          },
        },
        503,
      );
    }
    await next();
  });

  route.post("/api/v1/sellers/:sellerId/kyc-sessions", async (c) => {
    const sellerId = c.req.param("sellerId");
    const seller = await getSellerById(dependencies.pool, sellerId);
    if (!seller) {
      return c.json(
        { error: { code: "SELLER_NOT_FOUND", message: "販売者が見つかりません。" } },
        404,
      );
    }

    const authHeader = c.req.header("authorization");
    if (authHeader) {
      const session = await sessionFromAuthorization(
        authHeader,
        dependencies.walletConfig,
      );
      if (!session || session.userId !== sellerId) {
        return c.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "本人以外は本人確認を開始できません。",
            },
          },
          403,
        );
      }
    }

    try {
      const verification = await startVerificationSession(
        dependencies.pool,
        dependencies.diditConfig,
        {
          sellerId,
          callbackUrl: `${dependencies.frontendOrigin}/sellers/callback?sellerId=${encodeURIComponent(sellerId)}`,
        },
      );
      return c.json(
        {
          data: {
            sessionId: verification.providerSessionId,
            sessionUrl: verification.sessionUrl,
            status: verification.status,
          },
        },
        201,
      );
    } catch (error) {
      if (error instanceof DiditApiError) {
        return c.json(
          { error: { code: "DIDIT_SESSION_CREATE_FAILED", message: error.message } },
          502,
        );
      }
      throw error;
    }
  });

  route.get("/api/v1/sellers/:sellerId/verification", async (c) => {
    const sellerId = c.req.param("sellerId");
    const seller = await getSellerById(dependencies.pool, sellerId);
    if (!seller) {
      return c.json(
        { error: { code: "SELLER_NOT_FOUND", message: "販売者が見つかりません。" } },
        404,
      );
    }

    const shouldRefresh =
      c.req.query("refresh") === "1" && dependencies.diditConfig.enabled;
    const view = await getVerificationStatus(
      dependencies.pool,
      dependencies.diditConfig,
      sellerId,
      { refresh: shouldRefresh },
    );
    return c.json({ data: toVerificationResponse(view) });
  });

  return route;
}
