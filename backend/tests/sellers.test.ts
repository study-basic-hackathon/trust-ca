import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getSellerById: vi.fn(),
  registerSellerForUser: vi.fn(),
}));

const sessionModule = vi.hoisted(() => ({
  sessionFromAuthorization: vi.fn(),
}));

vi.mock("../src/db/sellers.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/db/sellers.js")>();
  return {
    ...original,
    ...repository,
  };
});

vi.mock("../src/services/session-token.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/services/session-token.js")>();
  return {
    ...original,
    ...sessionModule,
  };
});

const { createSellerRoute } = await import("../src/routes/sellers.js");
const { SellerAlreadyRegisteredError } = await import("../src/db/sellers.js");

const walletConfig = {
  sessionSecret: "test-secret",
  sessionTtlSeconds: 3600,
} as never;

const session = {
  userId: "0198a34a-4a6c-7000-8000-0000000000aa",
  walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  chainId: 137,
};

function createApp() {
  const app = new Hono();
  app.route("/", createSellerRoute({ pool: {} as never, walletConfig }));
  return app;
}

const seller = {
  id: session.userId,
  displayName: "テスト販売者",
  status: "active",
  onboardingStatus: "pending_kyc",
  createdAt: new Date("2026-08-17T00:00:00.000Z"),
};

describe("POST /api/v1/sellers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionModule.sessionFromAuthorization.mockResolvedValue(session);
  });

  it("ログイン済みユーザーを販売者として登録し201を返す", async () => {
    repository.registerSellerForUser.mockResolvedValue(seller);
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({ displayName: "テスト販売者" }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      data: { id: seller.id },
    });
    expect(repository.registerSellerForUser).toHaveBeenCalledWith(
      expect.anything(),
      session.userId,
      "テスト販売者",
    );
  });

  it("未ログインの登録を401で拒否する", async () => {
    sessionModule.sessionFromAuthorization.mockResolvedValue(null);
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "テスト販売者" }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    expect(repository.registerSellerForUser).not.toHaveBeenCalled();
  });

  it("登録済みユーザーの再登録を409で拒否する", async () => {
    repository.registerSellerForUser.mockRejectedValue(
      new SellerAlreadyRegisteredError(),
    );
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({ displayName: "テスト販売者" }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "SELLER_ALREADY_REGISTERED" },
    });
  });

  it("空文字の表示名を400で拒否する", async () => {
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({ displayName: "  " }),
    });

    expect(res.status).toBe(400);
    expect(repository.registerSellerForUser).not.toHaveBeenCalled();
  });

  it("101文字の表示名を400で拒否する", async () => {
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({ displayName: "あ".repeat(101) }),
    });

    expect(res.status).toBe(400);
    expect(repository.registerSellerForUser).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/sellers/:sellerId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("存在する販売者の公開情報を返す", async () => {
    repository.getSellerById.mockResolvedValue(seller);
    const app = createApp();

    const res = await app.request(`/api/v1/sellers/${seller.id}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: { displayName: "テスト販売者" },
    });
  });

  it("存在しない販売者は404を返す", async () => {
    repository.getSellerById.mockResolvedValue(null);
    const app = createApp();

    const res = await app.request("/api/v1/sellers/unknown-id");

    expect(res.status).toBe(404);
  });
});
