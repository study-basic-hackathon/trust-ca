import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminConfig } from "../src/env.js";

const verificationsDb = vi.hoisted(() => ({ getBySessionId: vi.fn() }));
const verificationsService = vi.hoisted(() => ({
  VerificationConflictError: class VerificationConflictError extends Error {},
  listInReview: vi.fn(),
  decideAsOperator: vi.fn(),
}));

vi.mock("../src/db/verifications.js", () => verificationsDb);
vi.mock("../src/services/verifications.js", () => verificationsService);

const { createAdminVerificationRoute } = await import(
  "../src/routes/admin-verifications.js"
);

const token = "admin-token-for-test-0123456789abcdef";
const adminConfig: AdminConfig = { token };

function createApp(config: AdminConfig = adminConfig) {
  const app = new Hono();
  app.route("/", createAdminVerificationRoute({ pool: {} as never, adminConfig: config }));
  return app;
}

const verification = {
  id: "verification-1",
  providerSessionId: "session-1",
  sellerId: "seller-1",
  status: "in_review",
  checks: null,
  requestedAt: new Date(),
  decidedAt: null,
};

describe("運営者向けAPIの認可", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Authorizationヘッダーがなければ401を返す", async () => {
    const app = createApp();
    const res = await app.request("/api/v1/admin/verifications");
    expect(res.status).toBe(401);
  });

  it("tokenが一致しなければ401を返す", async () => {
    const app = createApp();
    const res = await app.request("/api/v1/admin/verifications", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("ADMIN_API_TOKENが未設定なら常に401を返す", async () => {
    const app = createApp({ token: "" });
    const res = await app.request("/api/v1/admin/verifications", {
      headers: { authorization: "Bearer anything" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/admin/verifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("審査中の一覧を返す", async () => {
    verificationsService.listInReview.mockResolvedValue([
      { verification, events: [] },
    ]);
    const app = createApp();

    const res = await app.request("/api/v1/admin/verifications", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ sessionId: "session-1", status: "in_review" }],
    });
  });
});

describe("POST /api/v1/admin/verifications/:sessionId/decision", () => {
  beforeEach(() => vi.clearAllMocks());

  function decide(app: Hono, body: unknown) {
    return app.request("/api/v1/admin/verifications/session-1/decision", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("decisionが不正なら400を返す", async () => {
    const app = createApp();
    const res = await decide(app, { decision: "maybe", reason: "test" });
    expect(res.status).toBe(400);
  });

  it("reasonがなければ400を返す", async () => {
    const app = createApp();
    const res = await decide(app, { decision: "approved", reason: "" });
    expect(res.status).toBe(400);
  });

  it("対象セッションが見つからなければ404を返す", async () => {
    verificationsDb.getBySessionId.mockResolvedValue(null);
    const app = createApp();
    const res = await decide(app, { decision: "approved", reason: "確認済み" });
    expect(res.status).toBe(404);
  });

  it("承認を確定できる", async () => {
    verificationsDb.getBySessionId.mockResolvedValue(verification);
    verificationsService.decideAsOperator.mockResolvedValue({
      ...verification,
      status: "approved",
      decidedAt: new Date(),
    });
    const app = createApp();

    const res = await decide(app, { decision: "approved", reason: "確認済み" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: { status: "approved" } });
  });

  it("既にin_reviewでない場合は409を返す", async () => {
    verificationsDb.getBySessionId.mockResolvedValue(verification);
    verificationsService.decideAsOperator.mockRejectedValue(
      new verificationsService.VerificationConflictError("conflict"),
    );
    const app = createApp();

    const res = await decide(app, { decision: "approved", reason: "確認済み" });

    expect(res.status).toBe(409);
  });
});
