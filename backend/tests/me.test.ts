import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sellersDb = vi.hoisted(() => ({
  getSellerById: vi.fn(),
}));

const verificationsService = vi.hoisted(() => ({
  getVerificationStatus: vi.fn(),
}));

const sessionModule = vi.hoisted(() => ({
  sessionFromAuthorization: vi.fn(),
}));

vi.mock("../src/db/sellers.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/db/sellers.js")>();
  return { ...original, ...sellersDb };
});

vi.mock("../src/services/verifications.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/services/verifications.js")>();
  return { ...original, ...verificationsService };
});

vi.mock("../src/services/session-token.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/services/session-token.js")>();
  return { ...original, ...sessionModule };
});

const { createMeRoute } = await import("../src/routes/me.js");

const session = {
  userId: "0198a34a-4a6c-7000-8000-0000000000aa",
  walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  chainId: 137,
};

function createApp() {
  const app = new Hono();
  app.route(
    "/",
    createMeRoute({
      pool: {} as never,
      walletConfig: { sessionSecret: "s", sessionTtlSeconds: 3600 } as never,
      diditConfig: { enabled: false } as never,
    }),
  );
  return app;
}

describe("GET /api/v1/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionModule.sessionFromAuthorization.mockResolvedValue(session);
  });

  it("未ログインは401を返す", async () => {
    sessionModule.sessionFromAuthorization.mockResolvedValue(null);
    const app = createApp();

    const res = await app.request("/api/v1/me");

    expect(res.status).toBe(401);
  });

  it("販売者未登録ユーザーはseller=nullで返す", async () => {
    sellersDb.getSellerById.mockResolvedValue(null);
    const app = createApp();

    const res = await app.request("/api/v1/me", {
      headers: { authorization: "Bearer token" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        userId: session.userId,
        wallet: { address: session.walletAddress, chainId: session.chainId },
        seller: null,
        verification: null,
        isSellingAllowed: false,
      },
    });
    expect(verificationsService.getVerificationStatus).not.toHaveBeenCalled();
  });

  it("販売者登録済みユーザーはeKYC状態も返す", async () => {
    sellersDb.getSellerById.mockResolvedValue({
      id: session.userId,
      displayName: "テスト販売者",
      status: "active",
      onboardingStatus: "approved",
      createdAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    verificationsService.getVerificationStatus.mockResolvedValue({
      verification: {
        providerSessionId: "didit-session-1",
        status: "approved",
        checks: { document: "passed" },
        sessionUrl: null,
        requestedAt: new Date("2026-08-17T00:00:00.000Z"),
        decidedAt: new Date("2026-08-18T00:00:00.000Z"),
      },
      isSellingAllowed: true,
      events: [],
    });
    const app = createApp();

    const res = await app.request("/api/v1/me", {
      headers: { authorization: "Bearer token" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        seller: { displayName: "テスト販売者", onboardingStatus: "approved" },
        verification: { status: "approved" },
        isSellingAllowed: true,
      },
    });
  });
});
