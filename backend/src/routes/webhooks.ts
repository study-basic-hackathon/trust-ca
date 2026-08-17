import { Hono } from "hono";
import type { Pool } from "pg";
import type { DiditConfig } from "../env.js";
import { applyWebhook } from "../services/verifications.js";

type Dependencies = {
  pool: Pool;
  diditConfig: DiditConfig;
};

export function createWebhookRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/webhooks/didit", async (c) => {
    if (!dependencies.diditConfig.enabled) {
      return c.json(
        { error: { code: "DIDIT_MVP_DISABLED", message: "本人確認機能は現在無効です。" } },
        503,
      );
    }

    const rawBody = await c.req.text();
    const result = await applyWebhook(dependencies.pool, dependencies.diditConfig, {
      rawBody,
      headers: {
        "x-signature": c.req.header("x-signature"),
        "x-signature-v2": c.req.header("x-signature-v2"),
        "x-signature-simple": c.req.header("x-signature-simple"),
      },
    });

    if (result.outcome === "invalid_signature") {
      return c.json(
        { error: { code: "INVALID_SIGNATURE", message: "Webhook署名が無効です。" } },
        401,
      );
    }

    // Unknown sessions and already-processed duplicates are acknowledged with
    // 200 so Didit does not retry a webhook we cannot or need not act on.
    return c.json({ data: { acknowledged: true } });
  });

  return route;
}
