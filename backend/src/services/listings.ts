import type { Pool } from "pg";
import { getCardDetailById, type CardDetail } from "../db/cards.js";
import {
  countOpenListingsBySeller,
  createListing,
  getSellerLimits,
  type ListingRecord,
} from "../db/listings.js";
import { getSellerById } from "../db/sellers.js";

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
): Promise<{ listing: ListingRecord; card: CardDetail }> {
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

  const listing = await createListing(pool, {
    cardId: input.cardId,
    sellerId: input.sellerId,
    title: input.title,
    description: input.description,
    priceMinor: input.priceMinor,
  });
  return { listing, card };
}
