import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiditConfig } from "../src/env.js";

const verificationsService = vi.hoisted(() => ({ applyWebhook: vi.fn() }));
vi.mock("../src/services/verifications.js", () => verificationsService);

const { createWebhookRoute } = await import("../src/routes/webhooks.js");

const enabledDiditConfig: DiditConfig = {
  enabled: true,
  baseUrl: "https://verification.didit.me",
  apiKey: "key",
  workflowId: "workflow",
  webhookSecret: "secret",
};

function createApp(diditConfig: DiditConfig = enabledDiditConfig) {
  const app = new Hono();
  app.route("/", createWebhookRoute({ pool: {} as never, diditConfig }));
  return app;
}

function postWebhook(app: Hono, body: unknown = { session_id: "s1", status: "Approved" }) {
  return app.request("/api/v1/webhooks/didit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/webhooks/didit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Didit機能が無効なら503を返す", async () => {
    const app = createApp({ ...enabledDiditConfig, enabled: false });

    const res = await postWebhook(app);

    expect(res.status).toBe(503);
    expect(verificationsService.applyWebhook).not.toHaveBeenCalled();
  });

  it("署名が無効な場合は401を返し、状態は更新しない", async () => {
    verificationsService.applyWebhook.mockResolvedValue({ outcome: "invalid_signature" });
    const app = createApp();

    const res = await postWebhook(app);

    expect(res.status).toBe(401);
  });

  it("未知のsessionは200で受信確認だけ返す", async () => {
    verificationsService.applyWebhook.mockResolvedValue({ outcome: "unknown_session" });
    const app = createApp();

    const res = await postWebhook(app);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: { acknowledged: true } });
  });

  it("重複したイベントは200で受信確認だけ返す(状態は再適用しない)", async () => {
    verificationsService.applyWebhook.mockResolvedValue({ outcome: "duplicate" });
    const app = createApp();

    const res = await postWebhook(app);

    expect(res.status).toBe(200);
  });

  it("有効な通知を適用できたら200を返す", async () => {
    verificationsService.applyWebhook.mockResolvedValue({ outcome: "applied" });
    const app = createApp();

    const res = await postWebhook(app);

    expect(res.status).toBe(200);
    expect(verificationsService.applyWebhook).toHaveBeenCalledTimes(1);
  });
});
