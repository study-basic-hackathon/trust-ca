import { Hono } from "hono";
import type { Pool } from "pg";
import {
  CardAlreadyListedError,
  closeListing,
  getListingDetailById,
  listActiveListings,
  listListingsBySeller,
  type ListingDetail,
} from "../db/listings.js";
import { listCardImagesByCard } from "../db/card-images.js";
import type { PaymentConfig, VisionConfig } from "../env.js";
import {
  resolveWalletSession,
  UNAUTHORIZED_RESPONSE,
} from "../middleware/wallet-session.js";
import {
  createListingForSeller,
  ListingRuleViolationError,
  parsePriceMinor,
  validateListingText,
} from "../services/listings.js";
import { issueDownloadUrl } from "../services/storage.js";

type Dependencies = {
  pool: Pool;
  walletConfig: PaymentConfig;
  visionConfig: VisionConfig;
};

const IMAGE_URL_TTL_SECONDS = 15 * 60;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeCursor(listing: ListingDetail): string | null {
  if (!listing.publishedAt) return null;
  return Buffer.from(
    `${listing.publishedAt.getTime()}:${listing.id}`,
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  raw: string | undefined,
): { publishedAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const [ms, id] = Buffer.from(raw, "base64url").toString("utf8").split(":");
    const publishedAt = new Date(Number(ms));
    if (!id || Number.isNaN(publishedAt.getTime())) return null;
    return { publishedAt, id };
  } catch {
    return null;
  }
}

function toListingResponse(listing: ListingDetail) {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    priceMinor: listing.priceMinor,
    currency: listing.currency,
    status: listing.status,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
    seller: {
      id: listing.sellerId,
      displayName: listing.sellerDisplayName,
      isVerified: listing.sellerOnboardingStatus === "approved",
    },
    card: listing.card,
  };
}

/**
 * 出品API(api-catalog.md §6.5)。
 * 公開一覧・詳細は未認証で参照可能、作成・停止は販売者本人のみ。
 */
export function createListingsRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/listings", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.cardId !== "string") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST_BODY",
            message: "cardIdを含むリクエスト本文を指定してください。",
          },
        },
        400,
      );
    }

    try {
      const text = validateListingText({
        title: body.title,
        description: body.description,
      });
      const priceMinor = parsePriceMinor(body.priceMinor);
      const { listing, risk } = await createListingForSeller(
        dependencies.pool,
        {
          sellerId: session.userId,
          cardId: body.cardId,
          title: text.title,
          description: text.description,
          priceMinor,
        },
      );
      return c.json(
        {
          data: {
            ...listing,
            reviewRequired: risk.requiresReview,
            reviewReasons: risk.reasons,
          },
        },
        201,
      );
    } catch (error) {
      if (error instanceof ListingRuleViolationError) {
        const status =
          error.code === "SELLER_NOT_APPROVED"
            ? 403
            : error.code === "CARD_NOT_FOUND"
              ? 404
              : 400;
        return c.json(
          { error: { code: error.code, message: error.message } },
          status,
        );
      }
      if (error instanceof CardAlreadyListedError) {
        return c.json(
          { error: { code: "CARD_ALREADY_LISTED", message: error.message } },
          409,
        );
      }
      throw error;
    }
  });

  route.get("/api/v1/listings", async (c) => {
    const rawLimit = Number(c.req.query("limit") ?? DEFAULT_PAGE_LIMIT);
    const limit = Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;
    const search = c.req.query("search")?.trim() || null;
    const psaOnly = c.req.query("psaOnly") === "1";
    const cursor = decodeCursor(c.req.query("cursor"));
    const parsePrice = (raw: string | undefined): bigint | null =>
      raw && /^[0-9]+$/.test(raw) ? BigInt(raw) : null;
    const rawSort = c.req.query("sort");
    const sort =
      rawSort === "price_asc" || rawSort === "price_desc" ? rawSort : "new";

    const listings = await listActiveListings(dependencies.pool, {
      limit: limit + 1,
      cursor,
      search,
      psaOnly,
      minPriceMinor: parsePrice(c.req.query("minPrice")),
      maxPriceMinor: parsePrice(c.req.query("maxPrice")),
      sort,
    });
    const page = listings.slice(0, limit);
    const nextCursor =
      listings.length > limit ? encodeCursor(page[page.length - 1]) : null;

    return c.json({
      data: {
        items: page.map(toListingResponse),
        nextCursor,
      },
    });
  });

  route.get("/api/v1/listings/mine", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const listings = await listListingsBySeller(
      dependencies.pool,
      session.userId,
    );
    return c.json({ data: { items: listings.map(toListingResponse) } });
  });

  route.get("/api/v1/listings/:listingId", async (c) => {
    const listing = await getListingDetailById(
      dependencies.pool,
      c.req.param("listingId"),
    );
    if (!listing) {
      return c.json(
        {
          error: {
            code: "LISTING_NOT_FOUND",
            message: "出品が見つかりません。",
          },
        },
        404,
      );
    }

    // 非公開bucketの画像は短時間有効な閲覧URLへ変換して返す
    const images = await listCardImagesByCard(
      dependencies.pool,
      listing.cardId,
    );
    const imageViews = await Promise.all(
      images.map(async (image) => ({
        id: image.id,
        imageKind: image.imageKind,
        url: await issueDownloadUrl({
          bucket: image.storageBucket,
          objectKey: image.storageObject,
          ttlSeconds: IMAGE_URL_TTL_SECONDS,
        }).catch(() => null),
      })),
    );

    return c.json({
      data: {
        ...toListingResponse(listing),
        images: imageViews,
      },
    });
  });

  route.post("/api/v1/listings/:listingId/close", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const closed = await closeListing(dependencies.pool, {
      listingId: c.req.param("listingId"),
      sellerId: session.userId,
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

  return route;
}
