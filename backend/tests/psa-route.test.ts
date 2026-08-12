import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { PsaConfig } from "../src/env.js";
import { createFixedWindowRateLimiter } from "../src/middleware/rate-limit.js";
import { createPsaVerificationRoute } from "../src/routes/psa-verifications.js";
import { PsaServiceError } from "../src/services/psa.js";

const config: PsaConfig = {
  enabled: true,
  apiBaseUrl: "https://api.example.test/publicapi",
  apiToken: "secret-token",
  timeoutMs: 1_000,
  cacheTtlMs: 60_000,
  requestsPerMinute: 2,
};

function createApp(
  verify: ReturnType<typeof vi.fn>,
  overrides: Partial<PsaConfig> = {},
) {
  const app = new Hono();
  app.route(
    "/",
    createPsaVerificationRoute({
      config: { ...config, ...overrides },
      service: { verify },
      rateLimiter: createFixedWindowRateLimiter(
        overrides.requestsPerMinute ?? config.requestsPerMinute,
      ),
    }),
  );
  return app;
}

function post(app: Hono, body: string) {
  return app.request("/api/v1/cards/psa-verifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/v1/cards/psa-verifications", () => {
  it("正規化済みの照会結果を返す", async () => {
    const verify = vi.fn().mockResolvedValue({
      certNumber: "12345678",
      status: "verified",
      checkedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-14T00:00:00.000Z",
      source: "psa",
      cacheHit: false,
    });
    const response = await post(
      createApp(verify),
      JSON.stringify({ certNumber: " 12345678 " }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "verified" },
    });
    expect(verify).toHaveBeenCalledWith("12345678");
  });

  it.each([
    ["not json", "INVALID_REQUEST_BODY"],
    [JSON.stringify({ certNumber: "12-34" }), "INVALID_CERT_NUMBER"],
    [JSON.stringify({}), "INVALID_CERT_NUMBER"],
  ])("不正な入力を400で拒否する", async (body, code) => {
    const response = await post(createApp(vi.fn()), body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("機能フラグが無効なら上流へ接続しない", async () => {
    const verify = vi.fn();
    const response = await post(
      createApp(verify, { enabled: false }),
      JSON.stringify({ certNumber: "12345678" }),
    );

    expect(response.status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });

  it("上流障害を秘密情報なしの503へ変換する", async () => {
    const verify = vi
      .fn()
      .mockRejectedValue(
        new PsaServiceError("PSA_API_UNAVAILABLE", "contains internal detail"),
      );
    const response = await post(
      createApp(verify),
      JSON.stringify({ certNumber: "12345678" }),
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("internal detail");
  });

  it("同一送信元の上限超過を429で拒否する", async () => {
    const verify = vi.fn().mockResolvedValue({ status: "not_found" });
    const app = createApp(verify, { requestsPerMinute: 1 });
    await post(app, JSON.stringify({ certNumber: "12345678" }));
    const response = await post(
      app,
      JSON.stringify({ certNumber: "87654321" }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
