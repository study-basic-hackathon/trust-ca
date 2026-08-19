import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentConfig, VisionConfig } from "../src/env.js";

const analysesDb = vi.hoisted(() => ({
  listCardImageAnalysesForAdmin: vi.fn(),
}));

vi.mock("../src/db/card-images.js", () => ({
  getCardById: vi.fn(),
  getCardImageById: vi.fn(),
}));
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

function createApp() {
  const app = new Hono();
  app.route(
    "/",
    createCardImageAnalysesRoute({
      pool: {} as never,
      visionConfig,
      paymentConfig,
      visionService: { annotate: vi.fn() },
    }),
  );
  return app;
}

function get(app: Hono, path: string, authorization?: string) {
  return app.request(path, {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/v1/admin/card-image-analyses", () => {
  beforeEach(() => {
    analysesDb.listCardImageAnalysesForAdmin.mockReset();
    analysesDb.listCardImageAnalysesForAdmin.mockResolvedValue([
      {
        id: "analysis-1",
        cardId: "card-1",
        sourceImageId: "image-1",
        comparisonImageId: null,
        analysisKind: "ocr",
        provider: "google_vision",
        status: "in_review",
        score: 0,
        normalizedResult: null,
        completedAt: new Date("2026-08-19T00:00:00.000Z"),
        createdAt: new Date("2026-08-19T00:00:00.000Z"),
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        cardName: "Charizard ex",
        cardSeries: "SV1a",
        cardNumber: "006/070",
        storageBucket: "trustca-card-images-test",
        storageObject: "card-images/abc.jpg",
      },
    ]);
  });

  it("内部トークンなしを401で拒否する", async () => {
    const response = await get(createApp(), "/api/v1/admin/card-image-analyses");
    expect(response.status).toBe(401);
    expect(analysesDb.listCardImageAnalysesForAdmin).not.toHaveBeenCalled();
  });

  it("誤った内部トークンを401で拒否する", async () => {
    const response = await get(
      createApp(),
      "/api/v1/admin/card-image-analyses",
      "Bearer wrong-token",
    );
    expect(response.status).toBe(401);
  });

  it("status=in_reviewで絞り込んだ一覧を返す", async () => {
    const response = await get(
      createApp(),
      "/api/v1/admin/card-image-analyses?status=in_review",
      `Bearer ${visionConfig.adminToken}`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: "analysis-1",
          status: "in_review",
          card: { name: "Charizard ex" },
          image: { storageObject: "card-images/abc.jpg" },
        },
      ],
    });
    expect(analysesDb.listCardImageAnalysesForAdmin).toHaveBeenCalledWith(
      expect.anything(),
      { status: "in_review" },
    );
  });

  it("不正なstatus値を400で拒否する", async () => {
    const response = await get(
      createApp(),
      "/api/v1/admin/card-image-analyses?status=unknown",
      `Bearer ${visionConfig.adminToken}`,
    );
    expect(response.status).toBe(400);
  });
});
