import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  createSeller: vi.fn(),
  getSellerById: vi.fn(),
}));

vi.mock("../src/db/sellers.js", () => repository);

const { createSellerRoute } = await import("../src/routes/sellers.js");

function createApp() {
  const app = new Hono();
  app.route("/", createSellerRoute({ pool: {} as never }));
  return app;
}

const seller = {
  id: "0198a34a-4a6c-7000-8000-000000000001",
  displayName: "テスト販売者",
  status: "active",
  onboardingStatus: "pending_kyc",
  createdAt: new Date("2026-08-17T00:00:00.000Z"),
};

describe("POST /api/v1/sellers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("有効な表示名で販売者を作成し201を返す", async () => {
    repository.createSeller.mockResolvedValue(seller);
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "テスト販売者" }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ data: { id: seller.id } });
    expect(repository.createSeller).toHaveBeenCalledWith(expect.anything(), "テスト販売者");
  });

  it("空文字の表示名を400で拒否する", async () => {
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "  " }),
    });

    expect(res.status).toBe(400);
    expect(repository.createSeller).not.toHaveBeenCalled();
  });

  it("101文字の表示名を400で拒否する", async () => {
    const app = createApp();

    const res = await app.request("/api/v1/sellers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "あ".repeat(101) }),
    });

    expect(res.status).toBe(400);
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
      data: { onboardingStatus: "pending_kyc" },
    });
  });

  it("存在しない販売者を404で返す", async () => {
    repository.getSellerById.mockResolvedValue(null);
    const app = createApp();

    const res = await app.request("/api/v1/sellers/unknown-id");

    expect(res.status).toBe(404);
  });
});
