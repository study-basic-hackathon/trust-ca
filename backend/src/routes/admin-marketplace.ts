import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  closeListing,
  listListingsForAdmin,
} from "../db/listings.js";
import { listOrdersForAdmin } from "../db/orders.js";
import type { AdminConfig } from "../env.js";

type Dependencies = {
  pool: Pool;
  adminConfig: AdminConfig;
};

const ADMIN_LIST_LIMIT = 100;
const LISTING_STATUSES = new Set([
  "draft",
  "active",
  "reserved",
  "sold",
  "closed",
]);
const ORDER_STATUSES = new Set([
  "pending_payment",
  "payment_submitted",
  "paid",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
  "refunded",
]);

function tokenMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(received, "utf-8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 運営者向け: 出品管理・取引一覧(screen-design.md §3.13)。
 * 認可は既存のADMIN_API_TOKEN共有シークレット方式に合わせる。
 */
export function createAdminMarketplaceRoute(dependencies: Dependencies): Hono {
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

  route.get("/api/v1/admin/listings", async (c) => {
    const rawStatus = c.req.query("status") ?? null;
    const status = rawStatus && LISTING_STATUSES.has(rawStatus) ? rawStatus : null;
    const listings = await listListingsForAdmin(dependencies.pool, {
      status,
      limit: ADMIN_LIST_LIMIT,
    });
    return c.json({
      data: {
        items: listings.map((listing) => ({
          id: listing.id,
          title: listing.title,
          priceMinor: listing.priceMinor,
          status: listing.status,
          sellerDisplayName: listing.sellerDisplayName,
          cardName: listing.card.name,
          psaCertNumber: listing.card.psaCertNumber,
          createdAt: listing.createdAt.toISOString(),
        })),
      },
    });
  });

  route.post("/api/v1/admin/listings/:listingId/close", async (c) => {
    // sellerId=null で運営者権限の強制closeとして実行する
    const closed = await closeListing(dependencies.pool, {
      listingId: c.req.param("listingId"),
      sellerId: null,
    });
    if (!closed) {
      return c.json(
        {
          error: {
            code: "LISTING_STATE_CONFLICT",
            message:
              "出品を停止できません。取引中または既に終了している可能性があります。",
          },
        },
        409,
      );
    }
    return c.json({ data: { closed: true } });
  });

  route.get("/api/v1/admin/orders", async (c) => {
    const rawStatus = c.req.query("status") ?? null;
    const status = rawStatus && ORDER_STATUSES.has(rawStatus) ? rawStatus : null;
    const orders = await listOrdersForAdmin(dependencies.pool, {
      status,
      limit: ADMIN_LIST_LIMIT,
    });
    return c.json({
      data: {
        items: orders.map((order) => ({
          id: order.id,
          listingTitle: order.listingTitle,
          priceMinor: order.priceMinor,
          status: order.status,
          buyerDisplayName: order.buyerDisplayName,
          sellerDisplayName: order.sellerDisplayName,
          trackingNumber: order.shipment?.trackingNumber ?? null,
          createdAt: order.createdAt.toISOString(),
        })),
      },
    });
  });

  return route;
}
