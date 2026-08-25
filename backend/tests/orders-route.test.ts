import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ordersDb = vi.hoisted(() => ({
  createOrderFromListing: vi.fn(),
  getOrderViewById: vi.fn(),
  listOrdersForUser: vi.fn(),
  getShippingAddress: vi.fn(),
  listOrderAuditAnchors: vi.fn(),
  registerShipment: vi.fn(),
  confirmDelivery: vi.fn(),
}));

const sessionModule = vi.hoisted(() => ({
  sessionFromAuthorization: vi.fn(),
}));

vi.mock("../src/db/orders.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/orders.js")>()),
  ...ordersDb,
}));
vi.mock("../src/services/session-token.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/session-token.js")>()),
  ...sessionModule,
}));

const { createOrdersRoute } = await import("../src/routes/orders.js");
const { OrderRepositoryError } = await import("../src/db/orders.js");

const buyerSession = {
  userId: "buyer-user-id",
  walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  chainId: 137,
};

const shippingAddress = {
  recipientName: "山田太郎",
  postalCode: "100-0001",
  prefecture: "東京都",
  city: "千代田区",
  addressLine1: "千代田1-1-1",
  addressLine2: null,
  phoneNumber: "090-1234-5678",
};

const orderView = {
  id: "order-1",
  listingId: "listing-1",
  buyerId: "buyer-user-id",
  sellerId: "seller-user-id",
  priceMinor: "50000",
  currency: "JPY",
  status: "paid" as const,
  paidAt: new Date("2026-08-20T01:00:00.000Z"),
  shippedAt: null,
  deliveredAt: null,
  completedAt: null,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
  listingTitle: "リザードン HOLO",
  cardName: "リザードン",
  buyerDisplayName: "購入者",
  sellerDisplayName: "販売者",
  shipment: null,
};

function createApp() {
  const app = new Hono();
  app.route(
    "/",
    createOrdersRoute({
      pool: {} as never,
      walletConfig: { sessionSecret: "s", sessionTtlSeconds: 3600 } as never,
      onchainConfig: {
        enabled: false,
        chainId: 31337,
        contractAddress: "0x0000000000000000000000000000000000000001",
      } as never,
    }),
  );
  return app;
}

describe("POST /api/v1/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionModule.sessionFromAuthorization.mockResolvedValue(buyerSession);
  });

  it("配送先付きで注文を作成し201を返す", async () => {
    ordersDb.createOrderFromListing.mockResolvedValue({ orderId: "order-1" });
    const res = await createApp().request("/api/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ listingId: "listing-1", shippingAddress }),
    });
    expect(res.status).toBe(201);
    expect(ordersDb.createOrderFromListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        listingId: "listing-1",
        buyerId: buyerSession.userId,
      }),
    );
  });

  it("ハイフンなし郵便番号を正規化する", async () => {
    ordersDb.createOrderFromListing.mockResolvedValue({ orderId: "order-1" });
    await createApp().request("/api/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({
        listingId: "listing-1",
        shippingAddress: { ...shippingAddress, postalCode: "1000001" },
      }),
    });
    expect(ordersDb.createOrderFromListing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shippingAddress: expect.objectContaining({ postalCode: "100-0001" }),
      }),
    );
  });

  it("配送先不備は400を返す", async () => {
    const res = await createApp().request("/api/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({
        listingId: "listing-1",
        shippingAddress: { ...shippingAddress, postalCode: "123" },
      }),
    });
    expect(res.status).toBe(400);
    expect(ordersDb.createOrderFromListing).not.toHaveBeenCalled();
  });

  it("reserve競合は409を返す", async () => {
    ordersDb.createOrderFromListing.mockRejectedValue(
      new OrderRepositoryError(
        "LISTING_NOT_AVAILABLE",
        "この商品は現在購入できません。",
      ),
    );
    const res = await createApp().request("/api/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ listingId: "listing-1", shippingAddress }),
    });
    expect(res.status).toBe(409);
  });

  it("自己購入は403を返す", async () => {
    ordersDb.createOrderFromListing.mockRejectedValue(
      new OrderRepositoryError(
        "SELF_PURCHASE_FORBIDDEN",
        "自分の出品は購入できません。",
      ),
    );
    const res = await createApp().request("/api/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ listingId: "listing-1", shippingAddress }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/orders/:orderId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionModule.sessionFromAuthorization.mockResolvedValue(buyerSession);
    ordersDb.getShippingAddress.mockResolvedValue({
      ...shippingAddress,
      retentionUntil: null,
    });
    ordersDb.listOrderAuditAnchors.mockResolvedValue([
      {
        eventType: "order.paid",
        occurredAt: new Date("2026-08-20T01:00:00.000Z"),
        payloadSha256: "ab".repeat(32),
        outboxStatus: "confirmed",
        txHash: "0x" + "cd".repeat(32),
      },
    ]);
  });

  it("当事者には詳細と監査記録を返す", async () => {
    ordersDb.getOrderViewById.mockResolvedValue(orderView);
    const res = await createApp().request("/api/v1/orders/order-1", {
      headers: { authorization: "Bearer token" },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        viewerRole: "buyer",
        shippingAddress: { recipientName: "山田太郎" },
        auditAnchors: [{ eventType: "order.paid", outboxStatus: "confirmed" }],
      },
    });
  });

  it("第三者には404を返す(存在の秘匿)", async () => {
    ordersDb.getOrderViewById.mockResolvedValue({
      ...orderView,
      buyerId: "someone-else",
      sellerId: "another-one",
    });
    const res = await createApp().request("/api/v1/orders/order-1", {
      headers: { authorization: "Bearer token" },
    });
    expect(res.status).toBe(404);
  });

  it("完了後の販売者には配送先を返さない", async () => {
    sessionModule.sessionFromAuthorization.mockResolvedValue({
      ...buyerSession,
      userId: "seller-user-id",
    });
    ordersDb.getOrderViewById.mockResolvedValue({
      ...orderView,
      status: "completed",
    });
    const res = await createApp().request("/api/v1/orders/order-1", {
      headers: { authorization: "Bearer token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { shippingAddress: unknown };
    };
    expect(body.data.shippingAddress).toBeNull();
    expect(ordersDb.getShippingAddress).not.toHaveBeenCalled();
  });
});

describe("発送・受領確認", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionModule.sessionFromAuthorization.mockResolvedValue(buyerSession);
  });

  it("発送登録は不正なキャリアを400で拒否する", async () => {
    const res = await createApp().request("/api/v1/orders/order-1/shipment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ carrier: "unknown", trackingNumber: "1234-5678" }),
    });
    expect(res.status).toBe(400);
  });

  it("発送登録の状態競合は409を返す", async () => {
    ordersDb.registerShipment.mockRejectedValue(
      new OrderRepositoryError("ORDER_STATE_CONFLICT", "発送登録できません。"),
    );
    const res = await createApp().request("/api/v1/orders/order-1/shipment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ carrier: "yamato", trackingNumber: "1234-5678" }),
    });
    expect(res.status).toBe(409);
  });

  it("受領確認が成功するとcompletedを返す", async () => {
    ordersDb.confirmDelivery.mockResolvedValue(undefined);
    const res = await createApp().request(
      "/api/v1/orders/order-1/delivery-confirmation",
      { method: "POST", headers: { authorization: "Bearer token" } },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: { completed: true },
    });
    expect(ordersDb.confirmDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderId: "order-1",
        buyerId: buyerSession.userId,
        retentionDays: 90,
      }),
    );
  });
});
