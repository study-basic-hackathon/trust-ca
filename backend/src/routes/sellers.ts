import { Hono } from "hono";
import type { Pool } from "pg";
import {
  getSellerById,
  registerSellerForUser,
  SellerAlreadyRegisteredError,
  UserNotFoundError,
} from "../db/sellers.js";
import type { PaymentConfig } from "../env.js";
import {
  resolveWalletSession,
  UNAUTHORIZED_RESPONSE,
} from "../middleware/wallet-session.js";
import {
  InvalidDisplayNameError,
  normalizeDisplayName,
} from "../services/sellers.js";

type Dependencies = {
  pool: Pool;
  walletConfig: PaymentConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSellerRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  // 販売者登録はログイン済みユーザー本人のアカウントへ紐付ける。
  // 匿名での販売者作成は許可しない(spec 020: 認証×身元統合)。
  route.post("/api/v1/sellers", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }

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

    try {
      const seller = await registerSellerForUser(
        dependencies.pool,
        session.userId,
        displayName,
      );
      return c.json({ data: seller }, 201);
    } catch (error) {
      if (error instanceof SellerAlreadyRegisteredError) {
        return c.json(
          {
            error: {
              code: "SELLER_ALREADY_REGISTERED",
              message: error.message,
            },
          },
          409,
        );
      }
      if (error instanceof UserNotFoundError) {
        return c.json(
          { error: { code: "USER_NOT_FOUND", message: error.message } },
          404,
        );
      }
      throw error;
    }
  });

  route.get("/api/v1/sellers/:sellerId", async (c) => {
    const seller = await getSellerById(
      dependencies.pool,
      c.req.param("sellerId"),
    );
    if (!seller) {
      return c.json(
        {
          error: {
            code: "SELLER_NOT_FOUND",
            message: "販売者が見つかりません。",
          },
        },
        404,
      );
    }
    return c.json({ data: seller });
  });

  return route;
}
