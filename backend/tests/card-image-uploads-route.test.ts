import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentConfig, VisionConfig } from "../src/env.js";
import { issueWalletSession } from "../src/services/session-token.js";

const storage = vi.hoisted(() => ({
  issueUploadUrl: vi.fn(),
}));

vi.mock("../src/services/storage.js", () => storage);

const { createCardImageUploadsRoute } = await import(
  "../src/routes/card-image-uploads.js"
);

const paymentConfig: PaymentConfig = {
  enabled: true,
  rpcUrl: "http://localhost:8545",
  chainId: 31337,
  chainName: "Trustca Local",
  tokenAddress: `0x${"1".repeat(40)}`,
  expectedSymbol: "JPYC",
  confirmations: 1,
  pollIntervalMs: 100,
  batchSize: 5,
  lockTimeoutSeconds: 60,
  verificationTimeoutSeconds: 3_600,
  intentLifetimeSeconds: 900,
  workerId: "test-worker",
  sessionSecret: "s".repeat(32),
  sessionTtlSeconds: 3_600,
  siweDomain: "localhost:3000",
  siweUri: "http://localhost:3000",
  challengeTtlSeconds: 300,
};

const visionConfig: VisionConfig = {
  enabled: true,
  storageBucket: "trustca-card-images-test",
  apiBaseUrl: "https://vision.googleapis.com/v1",
  timeoutMs: 5_000,
  uploadUrlTtlSeconds: 900,
  adminToken: "a".repeat(32),
};

function createApp(overrides: Partial<VisionConfig> = {}) {
  const app = new Hono();
  app.route(
    "/",
    createCardImageUploadsRoute({
      visionConfig: { ...visionConfig, ...overrides },
      paymentConfig,
    }),
  );
  return app;
}

async function bearerToken(userId = "0198a34a-4a6c-7000-8000-000000000001") {
  const token = await issueWalletSession(
    { userId, walletAddress: `0x${"2".repeat(40)}`, chainId: 31337 },
    paymentConfig,
  );
  return `Bearer ${token}`;
}

function post(app: Hono, body: unknown, authorization?: string) {
  return app.request("/api/v1/uploads/card-images", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/uploads/card-images", () => {
  beforeEach(() => {
    storage.issueUploadUrl.mockReset();
  });

  it("認証済みユーザーへ署名付きURLを発行する", async () => {
    storage.issueUploadUrl.mockResolvedValue({
      objectKey: "card-images/abc.jpg",
      uploadUrl: "https://storage.googleapis.com/signed-url",
    });

    const response = await post(
      createApp(),
      { contentType: "image/jpeg" },
      await bearerToken(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        objectKey: "card-images/abc.jpg",
        uploadUrl: "https://storage.googleapis.com/signed-url",
        bucket: "trustca-card-images-test",
      },
    });
    expect(storage.issueUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "trustca-card-images-test",
        contentType: "image/jpeg",
      }),
    );
  });

  it("未認証を401で拒否する", async () => {
    const response = await post(createApp(), { contentType: "image/jpeg" });
    expect(response.status).toBe(401);
    expect(storage.issueUploadUrl).not.toHaveBeenCalled();
  });

  it("許可されていないcontent typeを400で拒否する", async () => {
    const response = await post(
      createApp(),
      { contentType: "application/pdf" },
      await bearerToken(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_CONTENT_TYPE" },
    });
  });

  it("機能フラグが無効なら503を返す", async () => {
    const response = await post(
      createApp({ enabled: false }),
      { contentType: "image/jpeg" },
      await bearerToken(),
    );
    expect(response.status).toBe(503);
    expect(storage.issueUploadUrl).not.toHaveBeenCalled();
  });
});
