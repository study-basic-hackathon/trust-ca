import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnchainConfig } from "../src/env.js";

const repository = vi.hoisted(() => ({
  createAuditAnchor: vi.fn(),
  getAuditAnchor: vi.fn(),
  IdempotencyConflictError: class extends Error {},
}));

vi.mock("../src/db/onchain-outbox.js", () => repository);

const { createOnchainAnchorRoute } = await import(
  "../src/routes/onchain-anchors.js"
);

const token = "internal-token-for-onchain-test-123456";
const config: OnchainConfig = {
  enabled: true,
  rpcUrl: "http://localhost:8545",
  chainId: 31337,
  chainName: "Trustca Local",
  contractAddress: `0x${"1".repeat(40)}`,
  operatorPrivateKey: `0x${"2".repeat(64)}`,
  confirmations: 1,
  receiptTimeoutMs: 1_000,
  pollIntervalMs: 100,
  batchSize: 5,
  lockTimeoutSeconds: 60,
  maxAttempts: 3,
  workerId: "worker-test",
  internalToken: token,
};
const validBody = {
  idempotencyKey: "order-paid:0198a34a-4a6c-7000",
  aggregateType: "order",
  aggregateId: "0198a34a-4a6c-7000-8000-000000000001",
  eventType: "order.paid",
  eventVersion: 1,
  occurredAt: "2026-08-13T00:00:00.000Z",
  payload: { orderId: "0198a34a-4a6c-7000-8000-000000000001" },
};

function createApp(overrides: Partial<OnchainConfig> = {}) {
  const app = new Hono();
  app.route(
    "/",
    createOnchainAnchorRoute({
      pool: {} as never,
      config: { ...config, ...overrides },
    }),
  );
  return app;
}

function request(app: Hono, body = validBody, authorization = `Bearer ${token}`) {
  return app.request("/api/v1/internal/onchain-anchors", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("internal onchain anchor API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("認証済みの監査イベントを202でoutboxへ登録する", async () => {
    repository.createAuditAnchor.mockResolvedValue({
      auditEventId: validBody.aggregateId,
      status: "pending",
      chainId: 31337,
      contractAddress: config.contractAddress,
      payloadSha256: "a".repeat(64),
      attemptCount: 0,
      txHash: null,
      blockNumber: null,
      confirmedAt: null,
      lastErrorCode: null,
      created: true,
    });
    const response = await request(createApp());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "pending", created: true },
    });
  });

  it("tokenなしを401で拒否する", async () => {
    const response = await request(createApp(), validBody, "");
    expect(response.status).toBe(401);
    expect(repository.createAuditAnchor).not.toHaveBeenCalled();
  });

  it("機能無効時は503で拒否する", async () => {
    const response = await request(createApp({ enabled: false }));
    expect(response.status).toBe(503);
  });

  it("不正な監査イベントを400で拒否する", async () => {
    const response = await request(createApp(), {
      ...validBody,
      aggregateId: "not-a-uuid",
    });
    expect(response.status).toBe(400);
  });

  it("深すぎるpayloadを400で拒否する", async () => {
    let payload: Record<string, unknown> = { value: "leaf" };
    for (let index = 0; index < 34; index += 1) payload = { nested: payload };

    const response = await request(createApp(), { ...validBody, payload });
    expect(response.status).toBe(400);
    expect(repository.createAuditAnchor).not.toHaveBeenCalled();
  });

  it("異なる内容でのidempotency key再利用を409にする", async () => {
    repository.createAuditAnchor.mockRejectedValue(
      new repository.IdempotencyConflictError(),
    );
    const response = await request(createApp());
    expect(response.status).toBe(409);
  });

  it("statusを取得する", async () => {
    repository.getAuditAnchor.mockResolvedValue({
      auditEventId: validBody.aggregateId,
      status: "confirmed",
      chainId: 31337,
      contractAddress: config.contractAddress,
      payloadSha256: "a".repeat(64),
      attemptCount: 1,
      txHash: `0x${"3".repeat(64)}`,
      blockNumber: "2",
      confirmedAt: new Date("2026-08-13T00:01:00Z"),
      lastErrorCode: null,
      created: false,
    });
    const response = await createApp().request(
      `/api/v1/internal/onchain-anchors/${validBody.aggregateId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "confirmed", blockNumber: "2" },
    });
  });
});
