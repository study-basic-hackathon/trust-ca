import { Hono } from "hono";
import type { Pool } from "pg";
import {
  listNotificationsForUser,
  markAllNotificationsRead,
} from "../db/notifications.js";
import type { PaymentConfig } from "../env.js";
import {
  resolveWalletSession,
  UNAUTHORIZED_RESPONSE,
} from "../middleware/wallet-session.js";

type Dependencies = {
  pool: Pool;
  walletConfig: PaymentConfig;
};

/** アプリ内通知欄(screen-design.md §6.6)。 */
export function createNotificationsRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.get("/api/v1/notifications", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const result = await listNotificationsForUser(
      dependencies.pool,
      session.userId,
    );
    return c.json({
      data: {
        items: result.items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
          orderId: item.orderId,
          isRead: item.readAt !== null,
          createdAt: item.createdAt.toISOString(),
        })),
        unreadCount: result.unreadCount,
      },
    });
  });

  route.post("/api/v1/notifications/read-all", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    await markAllNotificationsRead(dependencies.pool, session.userId);
    return c.json({ data: { read: true } });
  });

  return route;
}
