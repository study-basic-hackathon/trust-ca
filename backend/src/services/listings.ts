import type { Pool } from "pg";
import { getCardDetailById, type CardDetail } from "../db/cards.js";
import {
  countCompletedSalesBySeller,
  countOpenListingsBySeller,
  countRecentListingsBySeller,
  createListing,
  getSellerLimits,
  type ListingRecord,
} from "../db/listings.js";
import { hasPossessionProof } from "../db/possession.js";
import { getSellerById } from "../db/sellers.js";

/** Risk Engine最小ルールの閾値(screen-design.md §6.7)。環境変数で調整可能 */
const RISK_NEW_SELLER_AMOUNT_MINOR = BigInt(
  process.env.RISK_NEW_SELLER_AMOUNT_MINOR ?? "50000",
);
const RISK_RECENT_LISTING_LIMIT = Number(
  process.env.RISK_RECENT_LISTING_LIMIT ?? "5",
);

export type RiskEvaluation = {
  requiresReview: boolean;
  reasons: string[];
};

export class ListingRuleViolationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ListingRuleViolationError";
  }
}

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_PRICE_MINOR = 100_000_000_000n; // 1,000億円。桁誤り入力の防波堤

export type CreateListingInput = {
  sellerId: string;
  cardId: string;
  title: string;
  description: string | null;
  priceMinor: bigint;
};

export function parsePriceMinor(value: unknown): bigint {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && !/^[0-9]+$/.test(value)) ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new ListingRuleViolationError(
      "INVALID_PRICE",
      "価格は1以上の整数で入力してください。",
    );
  }
  const price = BigInt(value);
  if (price <= 0n || price > MAX_PRICE_MINOR) {
    throw new ListingRuleViolationError(
      "INVALID_PRICE",
      "価格は1以上の整数で入力してください。",
    );
  }
  return price;
}

export function validateListingText(input: {
  title: unknown;
  description: unknown;
}): { title: string; description: string | null } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new ListingRuleViolationError(
      "INVALID_TITLE",
      `タイトルは1〜${MAX_TITLE_LENGTH}文字で入力してください。`,
    );
  }
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ListingRuleViolationError(
      "INVALID_DESCRIPTION",
      `説明は${MAX_DESCRIPTION_LENGTH}文字以内で入力してください。`,
    );
  }
  return { title, description: description || null };
}

/**
 * 出品作成の業務ルール(ekyc-design.md 原則4「eKYC合格≠無制限出品」):
 * 1. 販売者がeKYC承認済み(onboarding_status=approved)であること
 * 2. カードが本人所有であること
 * 3. PSA番号があるカードは登録情報の照会実施済みであること
 * 4. seller_limits(出品数・金額上限)の範囲内であること
 */
export async function createListingForSeller(
  pool: Pool,
  input: CreateListingInput,
): Promise<{
  listing: ListingRecord;
  card: CardDetail;
  risk: RiskEvaluation;
}> {
  const seller = await getSellerById(pool, input.sellerId);
  if (!seller || seller.onboardingStatus !== "approved") {
    throw new ListingRuleViolationError(
      "SELLER_NOT_APPROVED",
      "出品には本人確認(eKYC)の承認が必要です。",
    );
  }

  const card = await getCardDetailById(pool, input.cardId);
  if (!card || card.currentOwnerId !== input.sellerId) {
    throw new ListingRuleViolationError(
      "CARD_NOT_FOUND",
      "出品対象のカードが見つかりません。",
    );
  }
  if (card.psaCertNumber && !card.psaVerificationStatus) {
    throw new ListingRuleViolationError(
      "PSA_VERIFICATION_REQUIRED",
      "PSA証明書番号が入力されたカードは、先に登録情報の照会が必要です。",
    );
  }

  const limits = await getSellerLimits(pool, input.sellerId);
  if (input.priceMinor > BigInt(limits.maxListingAmountMinor)) {
    throw new ListingRuleViolationError(
      "LISTING_AMOUNT_LIMIT_EXCEEDED",
      `現在の出品可能上限は${BigInt(limits.maxListingAmountMinor).toLocaleString("ja-JP")}円です。取引実績に応じて上限は拡大されます。`,
    );
  }
  const openCount = await countOpenListingsBySeller(pool, input.sellerId);
  if (openCount >= limits.activeListingLimit) {
    throw new ListingRuleViolationError(
      "LISTING_COUNT_LIMIT_EXCEEDED",
      `同時に公開できる出品は${limits.activeListingLimit}件までです。`,
    );
  }

  // 所持証明(nonce付き再撮影)は全出品で必須(screen-design.md §6.1)
  const hasProof = await hasPossessionProof(pool, input.cardId);
  if (!hasProof) {
    throw new ListingRuleViolationError(
      "POSSESSION_PROOF_REQUIRED",
      "出品には所持証明(確認コード付きの撮影)が必要です。",
    );
  }

  // Risk Engine最小ルール(screen-design.md §6.7)
  const risk = await evaluateListingRisk(pool, {
    sellerId: input.sellerId,
    priceMinor: input.priceMinor,
    card,
  });

  const listing = await createListing(pool, {
    cardId: input.cardId,
    sellerId: input.sellerId,
    title: input.title,
    description: input.description,
    priceMinor: input.priceMinor,
    requiresReview: risk.requiresReview,
  });
  return { listing, card, risk };
}

/**
 * ルールベースの公開前審査判定。該当した出品はdraftのまま保留し、
 * 運営者が内容確認後に公開する(事前審査の理念とUX速度の両立)。
 */
export async function evaluateListingRisk(
  pool: Pool,
  input: { sellerId: string; priceMinor: bigint; card: CardDetail },
): Promise<RiskEvaluation> {
  const reasons: string[] = [];

  const completedSales = await countCompletedSalesBySeller(pool, input.sellerId);
  if (completedSales === 0 && input.priceMinor > RISK_NEW_SELLER_AMOUNT_MINOR) {
    reasons.push(
      `取引実績のない販売者の高額出品(${RISK_NEW_SELLER_AMOUNT_MINOR.toLocaleString("ja-JP")}円超)`,
    );
  }

  const recentListings = await countRecentListingsBySeller(pool, input.sellerId);
  if (recentListings >= RISK_RECENT_LISTING_LIMIT) {
    reasons.push(`短時間の大量出品(24時間で${recentListings}件目)`);
  }

  if (input.card.psaCertNumber && input.card.psaVerificationStatus !== "verified") {
    reasons.push("PSA登録情報を自動確認できていない");
  }

  return { requiresReview: reasons.length > 0, reasons };
}
