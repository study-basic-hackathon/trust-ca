import { Hono } from "hono";
import type { Pool } from "pg";
import { createSeller, getSellerById } from "../db/sellers.js";
import { InvalidDisplayNameError, normalizeDisplayName } from "../services/sellers.js";

type Dependencies = {
  pool: Pool;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSellerRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/sellers", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    let displayName: string;
    try {
      displayName = normalizeDisplayName(
        isRecord(body) ? body.displayName : undefined,
      );
    } catch (error) {
      if (error instanceof InvalidDisplayNameError) {
        return c.json(
          { error: { code: "INVALID_DISPLAY_NAME", message: error.message } },
          400,
        );
      }
      throw error;
    }

    const seller = await createSeller(dependencies.pool, displayName);
    return c.json({ data: seller }, 201);
  });

  route.get("/api/v1/sellers/:sellerId", async (c) => {
    const seller = await getSellerById(dependencies.pool, c.req.param("sellerId"));
    if (!seller) {
      return c.json(
        { error: { code: "SELLER_NOT_FOUND", message: "販売者が見つかりません。" } },
        404,
      );
    }
    return c.json({ data: seller });
  });

  return route;
}
