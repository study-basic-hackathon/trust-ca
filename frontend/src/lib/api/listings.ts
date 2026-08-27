import { api } from "@/lib/api";
import type { UploadedCardImage } from "@/lib/api/card-images";

export type CardDetail = {
  id: string;
  currentOwnerId: string;
  name: string;
  series: string | null;
  cardNumber: string | null;
  grade: string | null;
  psaCertNumber: string | null;
  status: string;
  psaVerificationStatus: string | null;
};

export type PsaVerificationResult = {
  certNumber: string;
  status: "verified" | "not_found" | "invalid_request" | "in_review";
  checkedAt: string;
  cacheHit: boolean;
  verificationId: string | null;
  card?: {
    certNumber: string;
    year: string | null;
    brand: string | null;
    cardNumber: string | null;
    subject: string | null;
    variety: string | null;
    gradeDescription: string | null;
    cardGrade: string | null;
  };
};

export type ListingSummary = {
  id: string;
  title: string;
  description: string | null;
  priceMinor: string;
  currency: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  seller: { id: string; displayName: string; isVerified: boolean };
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

export type ListingDetailView = ListingSummary & {
  images: { id: string; imageKind: string; url: string | null }[];
};

export function createCard(
  token: string,
  input: {
    name: string;
    series?: string;
    cardNumber?: string;
    grade?: string;
    psaCertNumber?: string;
  },
): Promise<CardDetail> {
  return api<CardDetail>(
    "/api/v1/cards",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function verifyPsaCert(
  certNumber: string,
): Promise<PsaVerificationResult> {
  return api<PsaVerificationResult>("/api/v1/cards/psa-verifications", {
    method: "POST",
    body: JSON.stringify({ certNumber }),
  });
}

export function attachPsaVerification(
  token: string,
  cardId: string,
  psaVerificationId: string,
): Promise<{ attached: boolean }> {
  return api(
    `/api/v1/cards/${encodeURIComponent(cardId)}/psa-attachment`,
    { method: "POST", body: JSON.stringify({ psaVerificationId }) },
    token,
  );
}

export function createListing(
  token: string,
  input: {
    cardId: string;
    title: string;
    description: string | null;
    priceMinor: string;
  },
): Promise<{ id: string; reviewRequired: boolean; reviewReasons: string[] }> {
  return api(
    "/api/v1/listings",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function issuePossessionChallenge(
  token: string,
  cardId: string,
): Promise<{ code: string; expiresAt: string }> {
  return api(
    `/api/v1/cards/${encodeURIComponent(cardId)}/possession-challenges`,
    { method: "POST" },
    token,
  );
}

export type CardDraftSummary = CardDetail & {
  createdAt: string;
  thumbnailUrl: string | null;
};

/** まだ出品(listings)に至っていない、出品ウィザード途中のカード一覧 */
export function fetchCardDrafts(
  token: string,
): Promise<{ items: CardDraftSummary[] }> {
  return api("/api/v1/cards/mine", {}, token);
}

export type CardDraftDetail = {
  card: CardDetail & { createdAt: string };
  images: (UploadedCardImage & { url: string | null })[];
  hasPossessionProof: boolean;
};

/** 出品ウィザードの再開に必要な、カード・画像・所持確認状況をまとめて取得する */
export function fetchCardDraft(
  token: string,
  cardId: string,
): Promise<CardDraftDetail> {
  return api(`/api/v1/cards/${encodeURIComponent(cardId)}`, {}, token);
}

/** 出品ウィザードの破棄。まだ出品していないカードのみ破棄できる */
export function discardCard(
  token: string,
  cardId: string,
): Promise<{ discarded: boolean }> {
  return api(
    `/api/v1/cards/${encodeURIComponent(cardId)}/discard`,
    { method: "POST" },
    token,
  );
}

export type ListingSort = "new" | "price_asc" | "price_desc";

export function fetchListings(params: {
  search?: string;
  psaOnly?: boolean;
  cursor?: string | null;
  minPrice?: string;
  maxPrice?: string;
  sort?: ListingSort;
}): Promise<{ items: ListingSummary[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.psaOnly) query.set("psaOnly", "1");
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.minPrice) query.set("minPrice", params.minPrice);
  if (params.maxPrice) query.set("maxPrice", params.maxPrice);
  if (params.sort && params.sort !== "new") query.set("sort", params.sort);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return api(`/api/v1/listings${suffix}`);
}

export function fetchListingDetail(
  listingId: string,
): Promise<ListingDetailView> {
  return api(`/api/v1/listings/${encodeURIComponent(listingId)}`);
}

export function fetchMyListings(
  token: string,
): Promise<{ items: ListingSummary[] }> {
  return api("/api/v1/listings/mine", {}, token);
}

export function closeListing(
  token: string,
  listingId: string,
): Promise<{ closed: boolean }> {
  return api(
    `/api/v1/listings/${encodeURIComponent(listingId)}/close`,
    { method: "POST" },
    token,
  );
}
