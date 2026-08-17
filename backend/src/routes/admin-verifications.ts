import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import { getBySessionId } from "../db/verifications.js";
import type { AdminConfig } from "../env.js";
import {
  decideAsOperator,
  listInReview,
  VerificationConflictError,
} from "../services/verifications.js";

type Dependencies = {
  pool: Pool;
  adminConfig: AdminConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(received, "utf-8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAdminVerificationRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.use("/api/v1/admin/*", async (c, next) => {
    const header = c.req.header("authorization");
    const received = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (
      !dependencies.adminConfig.token ||
      !received ||
      !tokenMatches(dependencies.adminConfig.token, received)
    ) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "運営者認証が必要です。" } },
        401,
      );
    }
    await next();
  });

  route.get("/api/v1/admin/verifications", async (c) => {
    const items = await listInReview(dependencies.pool);
    return c.json({
      data: items.map(({ verification, events }) => ({
        sessionId: verification.providerSessionId,
        sellerId: verification.sellerId,
        status: verification.status,
        checks: verification.checks,
        requestedAt: verification.requestedAt.toISOString(),
        events: events.map((event) => ({
          eventType: event.eventType,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          source: event.source,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        })),
      })),
    });
  });

  route.post("/api/v1/admin/verifications/:sessionId/decision", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body: unknown = await c.req.json().catch(() => null);
    const decision = isRecord(body) ? body.decision : undefined;
    const reason = isRecord(body) && typeof body.reason === "string" ? body.reason.trim() : "";

    if ((decision !== "approved" && decision !== "declined") || !reason) {
      return c.json(
        {
          error: {
            code: "INVALID_DECISION_REQUEST",
            message: "decisionは'approved'/'declined'、reasonは必須です。",
          },
        },
        400,
      );
    }

    const verification = await getBySessionId(dependencies.pool, sessionId);
    if (!verification) {
      return c.json(
        {
          error: {
            code: "VERIFICATION_NOT_FOUND",
            message: "対象の本人確認セッションが見つかりません。",
          },
        },
        404,
      );
    }

    try {
      const updated = await decideAsOperator(dependencies.pool, {
        verificationId: verification.id,
        decision,
        reason,
        actorUserId: null,
      });
      return c.json({
        data: {
          sessionId: updated.providerSessionId,
          status: updated.status,
          decidedAt: updated.decidedAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      if (error instanceof VerificationConflictError) {
        return c.json(
          { error: { code: "VERIFICATION_CONFLICT", message: error.message } },
          409,
        );
      }
      throw error;
    }
  });

  return route;
}
