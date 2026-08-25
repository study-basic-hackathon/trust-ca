import { beforeEach, describe, expect, it, vi } from "vitest";

const sellersDb = vi.hoisted(() => ({ getSellerById: vi.fn() }));
const cardsDb = vi.hoisted(() => ({ getCardDetailById: vi.fn() }));
const listingsDb = vi.hoisted(() => ({
  createListing: vi.fn(),
  countOpenListingsBySeller: vi.fn(),
  getSellerLimits: vi.fn(),
}));

vi.mock("../src/db/sellers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/sellers.js")>()),
  ...sellersDb,
}));
vi.mock("../src/db/cards.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/cards.js")>()),
  ...cardsDb,
}));
vi.mock("../src/db/listings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/listings.js")>()),
  ...listingsDb,
}));

const {
  createListingForSeller,
  ListingRuleViolationError,
  parsePriceMinor,
} = await import("../src/services/listings.js");

const sellerId = "0198a34a-4a6c-7000-8000-0000000000aa";
const cardId = "0198a34a-4a6c-7000-8000-0000000000bb";

const approvedSeller = {
  id: sellerId,
  displayName: "テスト販売者",
  status: "active",
  onboardingStatus: "approved",
  createdAt: new Date(),
};

const ownedCard = {
  id: cardId,
  currentOwnerId: sellerId,
  name: "リザードン",
  series: null,
  cardNumber: null,
  grade: null,
  psaCertNumber: null,
  status: "draft",
  psaVerificationStatus: null,
  createdAt: new Date(),
};

const baseInput = {
  sellerId,
  cardId,
  title: "リザードン HOLO",
  description: null,
  priceMinor: 50_000n,
};

function expectRuleViolation(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof ListingRuleViolationError && error.code === code,
  );
}

describe("createListingForSeller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sellersDb.getSellerById.mockResolvedValue(approvedSeller);
    cardsDb.getCardDetailById.mockResolvedValue(ownedCard);
    listingsDb.getSellerLimits.mockResolvedValue({
      activeListingLimit: 3,
      maxListingAmountMinor: "100000",
    });
    listingsDb.countOpenListingsBySeller.mockResolvedValue(0);
    listingsDb.createListing.mockResolvedValue({ id: "listing-1" });
  });

  it("承認済み販売者の所有カードで出品を作成する", async () => {
    const result = await createListingForSeller({} as never, baseInput);
    expect(result.listing).toMatchObject({ id: "listing-1" });
    expect(listingsDb.createListing).toHaveBeenCalledWith(expect.anything(), {
      cardId,
      sellerId,
      title: "リザードン HOLO",
      description: null,
      priceMinor: 50_000n,
    });
  });

  it("eKYC未承認の販売者を拒否する", async () => {
    sellersDb.getSellerById.mockResolvedValue({
      ...approvedSeller,
      onboardingStatus: "pending_kyc",
    });
    await expectRuleViolation(
      createListingForSeller({} as never, baseInput),
      "SELLER_NOT_APPROVED",
    );
  });

  it("他人のカードを拒否する", async () => {
    cardsDb.getCardDetailById.mockResolvedValue({
      ...ownedCard,
      currentOwnerId: "other-user",
    });
    await expectRuleViolation(
      createListingForSeller({} as never, baseInput),
      "CARD_NOT_FOUND",
    );
  });

  it("PSA番号ありで照会未実施のカードを拒否する", async () => {
    cardsDb.getCardDetailById.mockResolvedValue({
      ...ownedCard,
      psaCertNumber: "12345678",
      psaVerificationStatus: null,
    });
    await expectRuleViolation(
      createListingForSeller({} as never, baseInput),
      "PSA_VERIFICATION_REQUIRED",
    );
  });

  it("金額上限の超過を拒否する", async () => {
    await expectRuleViolation(
      createListingForSeller({} as never, {
        ...baseInput,
        priceMinor: 100_001n,
      }),
      "LISTING_AMOUNT_LIMIT_EXCEEDED",
    );
  });

  it("同時出品数の上限超過を拒否する", async () => {
    listingsDb.countOpenListingsBySeller.mockResolvedValue(3);
    await expectRuleViolation(
      createListingForSeller({} as never, baseInput),
      "LISTING_COUNT_LIMIT_EXCEEDED",
    );
  });
});

describe("parsePriceMinor", () => {
  it("10進文字列と整数を受け付ける", () => {
    expect(parsePriceMinor("12000")).toBe(12_000n);
    expect(parsePriceMinor(500)).toBe(500n);
  });

  it.each([["0"], ["-1"], ["1.5"], ["abc"], [""], [null], [1.5]])(
    "不正な価格 %p を拒否する",
    (value) => {
      expect(() => parsePriceMinor(value)).toThrow(ListingRuleViolationError);
    },
  );
});
