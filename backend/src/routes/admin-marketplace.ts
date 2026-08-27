import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  closeListing,
  listListingsForAdmin,
  publishListing,
} from "../db/listings.js";
import { insertNotification } from "../db/notifications.js";
import { listOrdersForAdmin, resolveDispute, OrderRepositoryError } from "../db/orders.js";
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

  // 公開前審査: draft出品の公開(screen-design.md §6.5)
  route.post("/api/v1/admin/listings/:listingId/publish", async (c) => {
    const published = await publishListing(
      dependencies.pool,
      c.req.param("listingId"),
    );
    if (!published) {
      return c.json(
        {
          error: {
            code: "LISTING_STATE_CONFLICT",
            message: "この出品は審査待ち(draft)ではありません。",
          },
        },
        409,
      );
    }
    return c.json({ data: { published: true } });
  });

  // 紛争処理(screen-design.md §6.4)
  route.post("/api/v1/admin/orders/:orderId/dispute-resolution", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const resolution =
      typeof body === "object" && body !== null && "resolution" in body
        ? (body as { resolution?: string }).resolution
        : undefined;
    if (resolution !== "refunded" && resolution !== "resume") {
      return c.json(
        {
          error: {
            code: "INVALID_RESOLUTION",
            message: "resolutionはrefundedまたはresumeを指定してください。",
          },
        },
        400,
      );
    }
    try {
      await resolveDispute(dependencies.pool, {
        orderId: c.req.param("orderId"),
        resolution,
      });
      return c.json({ data: { resolved: true } });
    } catch (error) {
      if (error instanceof OrderRepositoryError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          409,
        );
      }
      throw error;
    }
  });

  // 販売者一覧と条件付き上限の調整(screen-design.md §6.8)
  route.get("/api/v1/admin/sellers", async (c) => {
    const result = await dependencies.pool.query(
      `SELECT u.id, u.display_name, sp.onboarding_status,
              COALESCE(sl.active_listing_limit, 3) AS active_listing_limit,
              COALESCE(sl.max_listing_amount_minor, 100000) AS max_listing_amount_minor,
              (SELECT count(*)::int FROM orders o
                WHERE o.seller_id = u.id AND o.status = 'completed') AS completed_sales
         FROM seller_profiles sp
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN seller_limits sl ON sl.seller_id = sp.user_id
        ORDER BY u.created_at DESC
        LIMIT 100`,
    );
    return c.json({
      data: {
        items: result.rows.map((row) => ({
          id: String(row.id),
          displayName: String(row.display_name),
          onboardingStatus: String(row.onboarding_status),
          activeListingLimit: Number(row.active_listing_limit),
          maxListingAmountMinor: String(row.max_listing_amount_minor),
          completedSales: Number(row.completed_sales),
        })),
      },
    });
  });

  route.patch("/api/v1/admin/sellers/:sellerId/limits", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const listingLimit = Number(record.activeListingLimit);
    const amountMinor = String(record.maxListingAmountMinor ?? "");
    if (
      !Number.isInteger(listingLimit) ||
      listingLimit < 0 ||
      listingLimit > 1000 ||
      !/^[0-9]+$/.test(amountMinor)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_LIMITS",
            message: "上限値(0以上の整数)を指定してください。",
          },
        },
        400,
      );
    }
    const sellerId = c.req.param("sellerId");
    await dependencies.pool.query(
      `INSERT INTO seller_limits (seller_id, active_listing_limit, max_listing_amount_minor)
       VALUES ($1, $2, $3)
       ON CONFLICT (seller_id) DO UPDATE
         SET active_listing_limit = $2,
             max_listing_amount_minor = $3,
             updated_at = CURRENT_TIMESTAMP`,
      [sellerId, listingLimit, amountMinor],
    );
    await insertNotification(dependencies.pool, {
      userId: sellerId,
      type: "listing_reviewed",
      title: "出品条件が更新されました",
      body: `同時出品${listingLimit}件・上限${BigInt(amountMinor).toLocaleString("ja-JP")}円になりました。`,
    }).catch(() => undefined);
    return c.json({ data: { updated: true } });
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
          disputeReasonCode: order.disputeReasonCode,
          disputeDescription: order.disputeDescription,
          createdAt: order.createdAt.toISOString(),
        })),
      },
    });
  });

  return route;
}
