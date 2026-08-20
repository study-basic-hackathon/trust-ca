import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listingsDb = vi.hoisted(() => ({
  getListingDetailById: vi.fn(),
  listActiveListings: vi.fn(),
  listListingsBySeller: vi.fn(),
  closeListing: vi.fn(),
}));

const listingsService = vi.hoisted(() => ({
  createListingForSeller: vi.fn(),
}));

const cardImagesDb = vi.hoisted(() => ({
  listCardImagesByCard: vi.fn(),
}));

const storageService = vi.hoisted(() => ({
  issueDownloadUrl: vi.fn(),
}));

const sessionModule = vi.hoisted(() => ({
  sessionFromAuthorization: vi.fn(),
}));

vi.mock("../src/db/listings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/listings.js")>()),
  ...listingsDb,
}));
vi.mock("../src/services/listings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/listings.js")>()),
  ...listingsService,
}));
vi.mock("../src/db/card-images.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/card-images.js")>()),
  ...cardImagesDb,
}));
vi.mock("../src/services/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/storage.js")>()),
  ...storageService,
}));
vi.mock("../src/services/session-token.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/session-token.js")>()),
  ...sessionModule,
}));

const { createListingsRoute } = await import("../src/routes/listings.js");

const session = {
  userId: "0198a34a-4a6c-7000-8000-0000000000aa",
  walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  chainId: 137,
};

const listingDetail = {
  id: "0198a34a-4a6c-7000-8000-0000000000cc",
  cardId: "0198a34a-4a6c-7000-8000-0000000000bb",
  sellerId: session.userId,
  title: "リザードン HOLO",
  description: null,
  priceMinor: "50000",
  currency: "JPY",
  status: "active" as const,
  publishedAt: new Date("2026-08-20T00:00:00.000Z"),
  closedAt: null,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  sellerDisplayName: "テスト販売者",
  sellerOnboardingStatus: "approved",
  card: {
    id: "0198a34a-4a6c-7000-8000-0000000000bb",
    name: "リザードン",
    series: null,
    cardNumber: null,
    grade: "10",
    psaCertNumber: "12345678",
    psaVerificationStatus: "verified",
  },
};

function createApp() {
  const app = new Hono();
  app.route(
    "/",
    createListingsRoute({
      pool: {} as never,
      walletConfig: { sessionSecret: "s", sessionTtlSeconds: 3600 } as never,
      visionConfig: {} as never,
    }),
  );
  return app;
}

describe("POST /api/v1/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionModule.sessionFromAuthorization.mockResolvedValue(session);
  });

  it("未ログインを401で拒否する", async () => {
    sessionModule.sessionFromAuthorization.mockResolvedValue(null);
    const res = await createApp().request("/api/v1/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("作成に成功すると201を返す", async () => {
    listingsService.createListingForSeller.mockResolvedValue({
      listing: { id: listingDetail.id },
      card: {},
    });
    const res = await createApp().request("/api/v1/listings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({
        cardId: listingDetail.cardId,
        title: "リザードン HOLO",
        priceMinor: "50000",
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/listings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("公開一覧とnextCursorを返す", async () => {
    listingsDb.listActiveListings.mockResolvedValue([listingDetail]);
    const res = await createApp().request("/api/v1/listings?limit=20");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: unknown[]; nextCursor: string | null };
    };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.nextCursor).toBeNull();
    expect(listingsDb.listActiveListings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 21 }),
    );
  });
});

describe("GET /api/v1/listings/:listingId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("詳細と画像URLを返す", async () => {
    listingsDb.getListingDetailById.mockResolvedValue(listingDetail);
    cardImagesDb.listCardImagesByCard.mockResolvedValue([
      {
        id: "img-1",
        imageKind: "front",
        storageBucket: "bucket",
        storageObject: "card-images/x.jpg",
      },
    ]);
    storageService.issueDownloadUrl.mockResolvedValue("https://signed.example");

    const res = await createApp().request(
      `/api/v1/listings/${listingDetail.id}`,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        seller: { isVerified: true },
        card: { psaVerificationStatus: "verified" },
        images: [{ id: "img-1", url: "https://signed.example" }],
      },
    });
  });

  it("存在しない出品は404を返す", async () => {
    listingsDb.getListingDetailById.mockResolvedValue(null);
    const res = await createApp().request("/api/v1/listings/unknown");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/listings/:listingId/close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionModule.sessionFromAuthorization.mockResolvedValue(session);
  });

  it("本人の出品を停止できる", async () => {
    listingsDb.closeListing.mockResolvedValue(true);
    const res = await createApp().request(
      `/api/v1/listings/${listingDetail.id}/close`,
      { method: "POST", headers: { authorization: "Bearer token" } },
    );
    expect(res.status).toBe(200);
    expect(listingsDb.closeListing).toHaveBeenCalledWith(expect.anything(), {
      listingId: listingDetail.id,
      sellerId: session.userId,
    });
  });

  it("停止できない状態は409を返す", async () => {
    listingsDb.closeListing.mockResolvedValue(false);
    const res = await createApp().request(
      `/api/v1/listings/${listingDetail.id}/close`,
      { method: "POST", headers: { authorization: "Bearer token" } },
    );
    expect(res.status).toBe(409);
  });
});
