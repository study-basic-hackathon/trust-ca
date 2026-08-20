import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type ListingStatus = "draft" | "active" | "reserved" | "sold" | "closed";

export type ListingRecord = {
  id: string;
  cardId: string;
  sellerId: string;
  title: string;
  description: string | null;
  priceMinor: string;
  currency: string;
  status: ListingStatus;
  publishedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
};

export type ListingDetail = ListingRecord & {
  sellerDisplayName: string;
  sellerOnboardingStatus: string;
  card: {
    id: string;
    name: string;
    series: string | null;
    cardNumber: string | null;
    grade: string | null;
    psaCertNumber: string | null;
    psaVerificationStatus: string | null;
  };
};

export type SellerLimits = {
  activeListingLimit: number;
  maxListingAmountMinor: string;
};

export class CardAlreadyListedError extends Error {
  constructor() {
    super("このカードは既に出品中です。");
    this.name = "CardAlreadyListedError";
  }
}

function toListing(row: Record<string, unknown>): ListingRecord {
  return {
    id: String(row.id),
    cardId: String(row.card_id),
    sellerId: String(row.seller_id),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    priceMinor: String(row.price_minor),
    currency: String(row.currency),
    status: String(row.status) as ListingStatus,
    publishedAt: row.published_at ? new Date(String(row.published_at)) : null,
    closedAt: row.closed_at ? new Date(String(row.closed_at)) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

function toListingDetail(row: Record<string, unknown>): ListingDetail {
  return {
    ...toListing(row),
    sellerDisplayName: String(row.seller_display_name),
    sellerOnboardingStatus: String(row.seller_onboarding_status),
    card: {
      id: String(row.card_id),
      name: String(row.card_name),
      series: row.card_series ? String(row.card_series) : null,
      cardNumber: row.card_number ? String(row.card_number) : null,
      grade: row.card_grade ? String(row.card_grade) : null,
      psaCertNumber: row.psa_cert_number ? String(row.psa_cert_number) : null,
      psaVerificationStatus: row.psa_verification_status
        ? String(row.psa_verification_status)
        : null,
    },
  };
}

const SELECT_LISTING_DETAIL = `
  SELECT l.id, l.card_id, l.seller_id, l.title, l.description, l.price_minor,
         l.currency, l.status, l.published_at, l.closed_at, l.created_at,
         u.display_name AS seller_display_name,
         sp.onboarding_status AS seller_onboarding_status,
         c.name AS card_name, c.series AS card_series,
         c.card_number AS card_number, c.grade AS card_grade,
         c.psa_cert_number,
         pv.status AS psa_verification_status
    FROM listings l
    JOIN users u ON u.id = l.seller_id
    JOIN seller_profiles sp ON sp.user_id = l.seller_id
    JOIN cards c ON c.id = l.card_id
    LEFT JOIN psa_verifications pv ON pv.id = c.latest_psa_verification_id`;

/**
 * 出品を作成し即時公開する。1カードにつきactive/reservedは1件のみ
 * (listings_one_open_per_card_uq)であり、違反はDB制約で拒否される。
 */
export async function createListing(
  pool: Pool,
  input: {
    cardId: string;
    sellerId: string;
    title: string;
    description: string | null;
    priceMinor: bigint;
  },
): Promise<ListingRecord> {
  const id = randomUUID();
  try {
    const result = await pool.query(
      `INSERT INTO listings
         (id, card_id, seller_id, title, description, price_minor, currency,
          status, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'JPY', 'active', CURRENT_TIMESTAMP)
       RETURNING id, card_id, seller_id, title, description, price_minor,
                 currency, status, published_at, closed_at, created_at`,
      [
        id,
        input.cardId,
        input.sellerId,
        input.title,
        input.description,
        input.priceMinor.toString(),
      ],
    );
    return toListing(result.rows[0]);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      throw new CardAlreadyListedError();
    }
    throw error;
  }
}

export async function getListingDetailById(
  pool: Pool,
  listingId: string,
): Promise<ListingDetail | null> {
  const result = await pool.query(`${SELECT_LISTING_DETAIL} WHERE l.id = $1`, [
    listingId,
  ]);
  return result.rows[0] ? toListingDetail(result.rows[0]) : null;
}

/**
 * 公開中出品の一覧。published_at DESC, id のカーソル方式。
 * カーソルは「publishedAtエポックms:id」の不透明文字列として扱う。
 */
export async function listActiveListings(
  pool: Pool,
  options: {
    limit: number;
    cursor: { publishedAt: Date; id: string } | null;
    search: string | null;
    psaOnly: boolean;
  },
): Promise<ListingDetail[]> {
  const conditions: string[] = [`l.status = 'active'`];
  const params: unknown[] = [];
  if (options.cursor) {
    params.push(options.cursor.publishedAt, options.cursor.id);
    conditions.push(
      `(l.published_at, l.id) < ($${params.length - 1}, $${params.length})`,
    );
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(
      `(c.name ILIKE $${params.length} OR l.title ILIKE $${params.length})`,
    );
  }
  if (options.psaOnly) {
    conditions.push(`c.psa_cert_number IS NOT NULL`);
  }
  params.push(options.limit);
  const result = await pool.query(
    `${SELECT_LISTING_DETAIL}
      WHERE ${conditions.join(" AND ")}
      ORDER BY l.published_at DESC, l.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(toListingDetail);
}

export async function listListingsBySeller(
  pool: Pool,
  sellerId: string,
): Promise<ListingDetail[]> {
  const result = await pool.query(
    `${SELECT_LISTING_DETAIL}
      WHERE l.seller_id = $1
      ORDER BY l.created_at DESC`,
    [sellerId],
  );
  return result.rows.map(toListingDetail);
}

/** 販売者のactive/reserved出品数(seller_limitsの上限判定に使用)。 */
export async function countOpenListingsBySeller(
  pool: Pool,
  sellerId: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS open_count
       FROM listings
      WHERE seller_id = $1 AND status IN ('active', 'reserved')`,
    [sellerId],
  );
  return Number(result.rows[0]?.open_count ?? 0);
}

/**
 * seller_limits(条件付き承認の上限)。行が無い場合はスキーマの
 * 既定値(3件・100,000円)で扱う。
 */
export async function getSellerLimits(
  pool: Pool,
  sellerId: string,
): Promise<SellerLimits> {
  const result = await pool.query(
    `SELECT active_listing_limit, max_listing_amount_minor
       FROM seller_limits
      WHERE seller_id = $1`,
    [sellerId],
  );
  const row = result.rows[0];
  return {
    activeListingLimit: row ? Number(row.active_listing_limit) : 3,
    maxListingAmountMinor: row ? String(row.max_listing_amount_minor) : "100000",
  };
}

/** 運営者向け全出品一覧(状態フィルタ任意)。 */
export async function listListingsForAdmin(
  pool: Pool,
  options: { status: string | null; limit: number },
): Promise<ListingDetail[]> {
  const params: unknown[] = [];
  let condition = "";
  if (options.status) {
    params.push(options.status);
    condition = `WHERE l.status = $${params.length}`;
  }
  params.push(options.limit);
  const result = await pool.query(
    `${SELECT_LISTING_DETAIL}
      ${condition}
      ORDER BY l.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(toListingDetail);
}

/** 出品停止。出品者本人または運営者のみ。期待遷移元をWHEREへ含める。 */
export async function closeListing(
  pool: Pool,
  input: { listingId: string; sellerId: string | null },
): Promise<boolean> {
  const params: unknown[] = [input.listingId];
  let sellerCondition = "";
  if (input.sellerId) {
    params.push(input.sellerId);
    sellerCondition = " AND seller_id = $2";
  }
  const result = await pool.query(
    `UPDATE listings
        SET status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status IN ('draft', 'active')${sellerCondition}`,
    params,
  );
  return (result.rowCount ?? 0) > 0;
}
