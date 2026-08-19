import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentConfig, VisionConfig } from "../src/env.js";
import { issueWalletSession } from "../src/services/session-token.js";
import { VisionServiceError } from "../src/services/vision.js";

const db = vi.hoisted(() => ({
  getCardById: vi.fn(),
}));
const imagesDb = vi.hoisted(() => ({
  getCardImageById: vi.fn(),
}));
const analysesDb = vi.hoisted(() => ({
  insertCardImageAnalysis: vi.fn(),
  getCardImageAnalysisById: vi.fn(),
}));
const visionAnnotate = vi.hoisted(() => vi.fn());

vi.mock("../src/db/card-images.js", () => ({ ...db, ...imagesDb }));
vi.mock("../src/db/card-image-analyses.js", () => analysesDb);

const { createCardImageAnalysesRoute } = await import(
  "../src/routes/card-image-analyses.js"
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

const CARD_ID = "0198a34a-4a6c-7000-8000-0000000000c1";
const IMAGE_ID = "0198a34a-4a6c-7000-8000-00000000000e";
const OTHER_CARD_ID = "0198a34a-4a6c-7000-8000-0000000000c2";

function createApp() {
  const app = new Hono();
  app.route(
    "/",
    createCardImageAnalysesRoute({
      pool: {} as never,
      visionConfig,
      paymentConfig,
      visionService: { annotate: visionAnnotate },
    }),
  );
  return app;
}

async function bearerToken() {
  const token = await issueWalletSession(
    {
      userId: "0198a34a-4a6c-7000-8000-000000000001",
      walletAddress: `0x${"2".repeat(40)}`,
      chainId: 31337,
    },
    paymentConfig,
  );
  return `Bearer ${token}`;
}

function post(app: Hono, body: unknown, authorization?: string) {
  return app.request("/api/v1/card-image-analyses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/card-image-analyses", () => {
  beforeEach(() => {
    db.getCardById.mockReset();
    imagesDb.getCardImageById.mockReset();
    analysesDb.insertCardImageAnalysis.mockReset();
    visionAnnotate.mockReset();

    db.getCardById.mockResolvedValue({
      id: CARD_ID,
      currentOwnerId: "seller-1",
      name: "Charizard ex",
      series: "SV1a",
      cardNumber: "006/070",
    });
    imagesDb.getCardImageById.mockResolvedValue({
      id: IMAGE_ID,
      cardId: CARD_ID,
      storageBucket: visionConfig.storageBucket,
      storageObject: "card-images/abc.jpg",
    });
  });

  it("内容が整合すればcompletedを返す", async () => {
    visionAnnotate.mockResolvedValue({
      ocrText: "Charizard ex 006/070",
      labels: [{ description: "Trading card", score: 0.9 }],
      objectBoundingBoxes: [],
    });
    analysesDb.insertCardImageAnalysis.mockImplementation(async (_pool, input) => ({
      id: "analysis-1",
      cardId: CARD_ID,
      sourceImageId: IMAGE_ID,
      comparisonImageId: null,
      analysisKind: "ocr",
      provider: "google_vision",
      status: input.status,
      score: input.score,
      normalizedResult: input.normalizedResult,
      completedAt: new Date("2026-08-19T00:00:00.000Z"),
      createdAt: new Date("2026-08-19T00:00:00.000Z"),
      updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    }));

    const response = await post(
      createApp(),
      { cardId: CARD_ID, imageId: IMAGE_ID },
      await bearerToken(),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "completed" },
    });
  });

  it("Vision APIが失敗してもfailedとして201で返す(HTTPエラーにしない)", async () => {
    visionAnnotate.mockRejectedValue(
      new VisionServiceError("VISION_API_UNAVAILABLE", "internal detail"),
    );
    analysesDb.insertCardImageAnalysis.mockImplementation(async (_pool, input) => ({
      id: "analysis-2",
      cardId: CARD_ID,
      sourceImageId: IMAGE_ID,
      comparisonImageId: null,
      analysisKind: "ocr",
      provider: "google_vision",
      status: input.status,
      score: input.score,
      normalizedResult: input.normalizedResult,
      completedAt: new Date("2026-08-19T00:00:00.000Z"),
      createdAt: new Date("2026-08-19T00:00:00.000Z"),
      updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    }));

    const response = await post(
      createApp(),
      { cardId: CARD_ID, imageId: IMAGE_ID },
      await bearerToken(),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({ data: { status: "failed", score: null } });
    expect(JSON.stringify(payload)).not.toContain("internal detail");
  });

  it("他カードの画像を指定すると404で拒否する", async () => {
    const response = await post(
      createApp(),
      { cardId: OTHER_CARD_ID, imageId: IMAGE_ID },
      await bearerToken(),
    );
    expect(response.status).toBe(404);
    expect(visionAnnotate).not.toHaveBeenCalled();
  });

  it("存在しないimageIdを404で拒否する", async () => {
    imagesDb.getCardImageById.mockResolvedValue(null);
    const response = await post(
      createApp(),
      { cardId: CARD_ID, imageId: IMAGE_ID },
      await bearerToken(),
    );
    expect(response.status).toBe(404);
  });

  it("未認証を401で拒否する", async () => {
    const response = await post(createApp(), { cardId: CARD_ID, imageId: IMAGE_ID });
    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/card-image-analyses/:analysisId", () => {
  beforeEach(() => {
    analysesDb.getCardImageAnalysisById.mockReset();
  });

  it("保存済みの解析結果を返す", async () => {
    analysesDb.getCardImageAnalysisById.mockResolvedValue({
      id: "analysis-1",
      cardId: CARD_ID,
      sourceImageId: IMAGE_ID,
      comparisonImageId: null,
      analysisKind: "ocr",
      provider: "google_vision",
      status: "completed",
      score: 1,
      normalizedResult: null,
      completedAt: new Date("2026-08-19T00:00:00.000Z"),
      createdAt: new Date("2026-08-19T00:00:00.000Z"),
      updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    });

    const response = await createApp().request(
      "/api/v1/card-image-analyses/analysis-1",
      { headers: { authorization: await bearerToken() } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "analysis-1", status: "completed" },
    });
  });

  it("存在しない解析結果を404で返す", async () => {
    analysesDb.getCardImageAnalysisById.mockResolvedValue(null);
    const response = await createApp().request(
      "/api/v1/card-image-analyses/analysis-404",
      { headers: { authorization: await bearerToken() } },
    );
    expect(response.status).toBe(404);
  });
});
