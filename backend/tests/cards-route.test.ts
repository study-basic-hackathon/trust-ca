import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentConfig } from "../src/env.js";
import { issueWalletSession } from "../src/services/session-token.js";

const cardsDb = vi.hoisted(() => ({
  getCardDetailById: vi.fn(),
  listCardDraftsByOwner: vi.fn(),
  discardCard: vi.fn(),
}));
const cardImagesDb = vi.hoisted(() => ({
  listCardImagesByCard: vi.fn(),
  listPrimaryImagesByCards: vi.fn(),
}));
const possessionDb = vi.hoisted(() => ({
  hasPossessionProof: vi.fn(),
}));
const storageService = vi.hoisted(() => ({
  issueDownloadUrl: vi.fn(),
}));

vi.mock("../src/db/cards.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/cards.js")>()),
  ...cardsDb,
}));
vi.mock("../src/db/card-images.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/card-images.js")>()),
  ...cardImagesDb,
}));
vi.mock("../src/db/possession.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/possession.js")>()),
  ...possessionDb,
}));
vi.mock("../src/services/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/storage.js")>()),
  ...storageService,
}));

const { createCardsRoute } = await import("../src/routes/cards.js");

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

const OWNER_ID = "0198a34a-4a6c-7000-8000-000000000001";
const OTHER_USER_ID = "0198a34a-4a6c-7000-8000-000000000002";
const CARD_ID = "0198a34a-4a6c-7000-8000-0000000000c1";

const cardDetail = {
  id: CARD_ID,
  currentOwnerId: OWNER_ID,
  name: "リザードン",
  series: null,
  cardNumber: null,
  grade: null,
  psaCertNumber: null,
  status: "draft",
  psaVerificationStatus: null,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
};

function createApp() {
  const app = new Hono();
  app.route("/", createCardsRoute({ pool: {} as never, walletConfig: paymentConfig }));
  return app;
}

async function bearerToken(userId: string) {
  const token = await issueWalletSession(
    { userId, walletAddress: `0x${"2".repeat(40)}`, chainId: 31337 },
    paymentConfig,
  );
  return `Bearer ${token}`;
}

beforeEach(() => {
  cardsDb.getCardDetailById.mockReset();
  cardsDb.listCardDraftsByOwner.mockReset();
  cardsDb.discardCard.mockReset();
  cardImagesDb.listCardImagesByCard.mockReset();
  cardImagesDb.listPrimaryImagesByCards.mockReset().mockResolvedValue([]);
  possessionDb.hasPossessionProof.mockReset();
  storageService.issueDownloadUrl.mockReset().mockResolvedValue("https://example.com/signed");
});

describe("GET /api/v1/cards/mine", () => {
  it("未認証を401で拒否する", async () => {
    const response = await createApp().request("/api/v1/cards/mine");
    expect(response.status).toBe(401);
  });

  it("出品に至っていない自分のカード一覧を返す", async () => {
    cardsDb.listCardDraftsByOwner.mockResolvedValue([cardDetail]);
    const response = await createApp().request("/api/v1/cards/mine", {
      headers: { authorization: await bearerToken(OWNER_ID) },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ id: CARD_ID, name: "リザードン" });
    expect(cardsDb.listCardDraftsByOwner).toHaveBeenCalledWith(
      expect.anything(),
      OWNER_ID,
    );
  });
});

describe("GET /api/v1/cards/:cardId", () => {
  it("他人のカードを404で拒否する", async () => {
    cardsDb.getCardDetailById.mockResolvedValue(cardDetail);
    const response = await createApp().request(`/api/v1/cards/${CARD_ID}`, {
      headers: { authorization: await bearerToken(OTHER_USER_ID) },
    });
    expect(response.status).toBe(404);
  });

  it("本人のカードは画像・所持確認状況とともに返す", async () => {
    cardsDb.getCardDetailById.mockResolvedValue(cardDetail);
    cardImagesDb.listCardImagesByCard.mockResolvedValue([
      {
        id: "0198a34a-4a6c-7000-8000-0000000000aa",
        cardId: CARD_ID,
        uploadedByUserId: OWNER_ID,
        imageKind: "front",
        storageBucket: "bucket",
        storageObject: "object.jpg",
        contentType: "image/jpeg",
        byteSize: 100,
        sha256: "a".repeat(64),
        captureNonce: null,
        retentionUntil: null,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
      },
    ]);
    possessionDb.hasPossessionProof.mockResolvedValue(true);

    const response = await createApp().request(`/api/v1/cards/${CARD_ID}`, {
      headers: { authorization: await bearerToken(OWNER_ID) },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.card.id).toBe(CARD_ID);
    expect(body.data.hasPossessionProof).toBe(true);
    expect(body.data.images).toHaveLength(1);
    expect(body.data.images[0]).toMatchObject({
      imageKind: "front",
      url: "https://example.com/signed",
    });
  });
});

describe("POST /api/v1/cards/:cardId/discard", () => {
  it("未認証を401で拒否する", async () => {
    const response = await createApp().request(
      `/api/v1/cards/${CARD_ID}/discard`,
      { method: "POST" },
    );
    expect(response.status).toBe(401);
  });

  it("破棄できたら200を返す", async () => {
    cardsDb.discardCard.mockResolvedValue(true);
    const response = await createApp().request(
      `/api/v1/cards/${CARD_ID}/discard`,
      { method: "POST", headers: { authorization: await bearerToken(OWNER_ID) } },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { discarded: true },
    });
    expect(cardsDb.discardCard).toHaveBeenCalledWith(expect.anything(), {
      cardId: CARD_ID,
      ownerId: OWNER_ID,
    });
  });

  it("既に出品済み・存在しない場合は409を返す", async () => {
    cardsDb.discardCard.mockResolvedValue(false);
    const response = await createApp().request(
      `/api/v1/cards/${CARD_ID}/discard`,
      { method: "POST", headers: { authorization: await bearerToken(OWNER_ID) } },
    );
    expect(response.status).toBe(409);
  });
});
