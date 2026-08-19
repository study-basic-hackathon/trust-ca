import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentConfig, VisionConfig } from "../src/env.js";
import { issueWalletSession } from "../src/services/session-token.js";

const db = vi.hoisted(() => ({
  getCardById: vi.fn(),
  insertCardImage: vi.fn(),
}));
const storage = vi.hoisted(() => ({
  verifyUploadedObject: vi.fn(),
}));

vi.mock("../src/db/card-images.js", () => db);
vi.mock("../src/services/storage.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/services/storage.js")>();
  return { ...actual, ...storage };
});

const { createCardImagesRoute } = await import(
  "../src/routes/card-images.js"
);
const { StorageServiceError } = await import("../src/services/storage.js");

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

const CARD_ID = "0198a34a-4a6c-7000-8000-0000000000c1";
const OWNER_ID = "0198a34a-4a6c-7000-8000-000000000001";
const OTHER_USER_ID = "0198a34a-4a6c-7000-8000-000000000002";

const validBody = {
  objectKey: "card-images/abc.jpg",
  contentType: "image/jpeg",
  byteSize: 123_456,
  sha256: "a".repeat(64),
  imageKind: "corner_top_left",
  uploadContext: "listing",
};

function createApp() {
  const app = new Hono();
  app.route(
    "/",
    createCardImagesRoute({
      pool: {} as never,
      visionConfig,
      paymentConfig,
    }),
  );
  return app;
}

async function bearerToken(userId: string) {
  const token = await issueWalletSession(
    { userId, walletAddress: `0x${"2".repeat(40)}`, chainId: 31337 },
    paymentConfig,
  );
  return `Bearer ${token}`;
}

function post(app: Hono, body: unknown, authorization?: string) {
  return app.request(`/api/v1/cards/${CARD_ID}/images`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/cards/:cardId/images", () => {
  beforeEach(() => {
    db.getCardById.mockReset();
    db.insertCardImage.mockReset();
    storage.verifyUploadedObject.mockReset();
    db.getCardById.mockResolvedValue({
      id: CARD_ID,
      currentOwnerId: OWNER_ID,
      name: "リザードンex",
      series: "SV1a",
      cardNumber: "006/070",
    });
    storage.verifyUploadedObject.mockResolvedValue(undefined);
    db.insertCardImage.mockResolvedValue({
      id: "0198a34a-4a6c-7000-8000-0000000000aa",
      cardId: CARD_ID,
      uploadedByUserId: OWNER_ID,
      imageKind: "corner_top_left",
      storageBucket: visionConfig.storageBucket,
      storageObject: validBody.objectKey,
      contentType: validBody.contentType,
      byteSize: validBody.byteSize,
      sha256: validBody.sha256,
      captureNonce: null,
      retentionUntil: null,
      createdAt: new Date("2026-08-19T00:00:00.000Z"),
    });
  });

  it("出品者が出品時画像を登録できる", async () => {
    const response = await post(
      createApp(),
      validBody,
      await bearerToken(OWNER_ID),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { imageKind: "corner_top_left" },
    });
    expect(storage.verifyUploadedObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: visionConfig.storageBucket,
        objectKey: validBody.objectKey,
        expectedSha256: validBody.sha256,
      }),
    );
  });

  it("出品者以外による出品時アップロードを403で拒否する", async () => {
    const response = await post(
      createApp(),
      validBody,
      await bearerToken(OTHER_USER_ID),
    );
    expect(response.status).toBe(403);
    expect(db.insertCardImage).not.toHaveBeenCalled();
  });

  it("到着後アップロードは所有者以外でも許可する", async () => {
    const response = await post(
      createApp(),
      { ...validBody, uploadContext: "arrival" },
      await bearerToken(OTHER_USER_ID),
    );
    expect(response.status).toBe(201);
  });

  it("存在しないcardIdを404で拒否する", async () => {
    db.getCardById.mockResolvedValue(null);
    const response = await post(
      createApp(),
      validBody,
      await bearerToken(OWNER_ID),
    );
    expect(response.status).toBe(404);
  });

  it.each([
    [{ ...validBody, contentType: "application/pdf" }, "INVALID_CONTENT_TYPE"],
    [{ ...validBody, byteSize: 0 }, "INVALID_BYTE_SIZE"],
    [{ ...validBody, byteSize: 100 * 1024 * 1024 }, "INVALID_BYTE_SIZE"],
    [{ ...validBody, sha256: "not-hex" }, "INVALID_SHA256"],
    [{ ...validBody, imageKind: "selfie" }, "INVALID_IMAGE_KIND"],
    [{ ...validBody, uploadContext: "unknown" }, "INVALID_UPLOAD_CONTEXT"],
  ])("不正な入力を400で拒否する", async (body, code) => {
    const response = await post(createApp(), body, await bearerToken(OWNER_ID));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("Cloud Storage側の検証失敗を422へ変換する", async () => {
    storage.verifyUploadedObject.mockRejectedValue(
      new StorageServiceError(
        "STORAGE_SHA256_MISMATCH",
        "sha256 mismatch",
      ),
    );
    const response = await post(
      createApp(),
      validBody,
      await bearerToken(OWNER_ID),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STORAGE_SHA256_MISMATCH" },
    });
  });
});
