import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiditConfig, PaymentConfig } from "../src/env.js";

const sellers = vi.hoisted(() => ({ getSellerById: vi.fn() }));
const sessionToken = vi.hoisted(() => ({ sessionFromAuthorization: vi.fn() }));
const verificationsService = vi.hoisted(() => ({
  DiditApiError: class DiditApiError extends Error {},
  startVerificationSession: vi.fn(),
  getVerificationStatus: vi.fn(),
}));

vi.mock("../src/db/sellers.js", () => sellers);
vi.mock("../src/services/session-token.js", () => sessionToken);
vi.mock("../src/services/verifications.js", () => verificationsService);

const { createKycRoute } = await import("../src/routes/kyc.js");

const sellerId = "0198a34a-4a6c-7000-8000-000000000001";
const seller = {
  id: sellerId,
  displayName: "テスト販売者",
  status: "active",
  onboardingStatus: "pending_kyc",
  createdAt: new Date(),
};

const enabledDiditConfig: DiditConfig = {
  enabled: true,
  baseUrl: "https://verification.didit.me",
  apiKey: "key",
  workflowId: "workflow",
  webhookSecret: "secret",
};

const walletConfig = {} as PaymentConfig;

function createApp(diditConfig: DiditConfig = enabledDiditConfig) {
  const app = new Hono();
  app.route(
    "/",
    createKycRoute({
      pool: {} as never,
      diditConfig,
      walletConfig,
      frontendOrigin: "http://localhost:3000",
    }),
  );
  return app;
}

describe("POST /api/v1/sellers/:sellerId/kyc-sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Didit機能が無効なら503を返す", async () => {
    const app = createApp({ ...enabledDiditConfig, enabled: false });

    const res = await app.request(`/api/v1/sellers/${sellerId}/kyc-sessions`, {
      method: "POST",
    });

    expect(res.status).toBe(503);
  });

  it("存在しない販売者を404で返す", async () => {
    sellers.getSellerById.mockResolvedValue(null);
    const app = createApp();

    const res = await app.request(`/api/v1/sellers/${sellerId}/kyc-sessions`, {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });

  it("Authorizationヘッダーがなければ本人確認を開始できる", async () => {
    sellers.getSellerById.mockResolvedValue(seller);
    verificationsService.startVerificationSession.mockResolvedValue({
      providerSessionId: "session-1",
      sessionUrl: "https://verification.didit.me/session-1",
      status: "not_started",
    });
    const app = createApp();

    const res = await app.request(`/api/v1/sellers/${sellerId}/kyc-sessions`, {
      method: "POST",
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      data: { sessionId: "session-1", status: "not_started" },
    });
  });

  it("Authorizationヘッダーが別ユーザーのsessionなら403を返す", async () => {
    sellers.getSellerById.mockResolvedValue(seller);
    sessionToken.sessionFromAuthorization.mockResolvedValue({
      userId: "someone-else",
    });
    const app = createApp();

    const res = await app.request(`/api/v1/sellers/${sellerId}/kyc-sessions`, {
      method: "POST",
      headers: { authorization: "Bearer token" },
    });

    expect(res.status).toBe(403);
    expect(verificationsService.startVerificationSession).not.toHaveBeenCalled();
  });

  it("Authorizationヘッダーが本人のsessionなら開始できる", async () => {
    sellers.getSellerById.mockResolvedValue(seller);
    sessionToken.sessionFromAuthorization.mockResolvedValue({ userId: sellerId });
    verificationsService.startVerificationSession.mockResolvedValue({
      providerSessionId: "session-1",
      sessionUrl: "https://verification.didit.me/session-1",
      status: "not_started",
    });
    const app = createApp();

    const res = await app.request(`/api/v1/sellers/${sellerId}/kyc-sessions`, {
      method: "POST",
      headers: { authorization: "Bearer token" },
    });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/sellers/:sellerId/verification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("存在しない販売者を404で返す", async () => {
    sellers.getSellerById.mockResolvedValue(null);
    const app = createApp();

    const res = await app.request(`/api/v1/sellers/${sellerId}/verification`);

    expect(res.status).toBe(404);
  });

  it("最新の本人確認状態を返す", async () => {
    sellers.getSellerById.mockResolvedValue(seller);
    verificationsService.getVerificationStatus.mockResolvedValue({
      verification: {
        providerSessionId: "session-1",
        status: "in_review",
        checks: null,
        sessionUrl: null,
        requestedAt: new Date(),
        decidedAt: null,
      },
      isSellingAllowed: false,
      events: [],
    });
    const app = createApp();

    const res = await app.request(`/api/v1/sellers/${sellerId}/verification`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: { isSellingAllowed: false, verification: { status: "in_review" } },
    });
  });
});
