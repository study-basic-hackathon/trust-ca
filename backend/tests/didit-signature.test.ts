import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  stableStringify,
  verifyWebhookSignature,
} from "../src/services/didit/signature.js";

const secret = "test-webhook-secret";

function bodyWithTimestamp(nowSeconds: number, overrides: Record<string, unknown> = {}) {
  return {
    created_at: nowSeconds,
    session_id: "session-1",
    status: "Approved",
    webhook_type: "status.updated",
    ...overrides,
  };
}

describe("verifyWebhookSignature", () => {
  it("有効なV2署名を受理する", () => {
    const now = Math.floor(Date.now() / 1000);
    const body = bodyWithTimestamp(now);
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", secret)
      .update(stableStringify(body), "utf-8")
      .digest("hex");

    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature-v2": signature },
      secret,
      nowSeconds: now,
    });

    expect(result).toEqual({ isValid: true, method: "v2" });
  });

  it("不正な署名を拒否する", () => {
    const now = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify(bodyWithTimestamp(now));

    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature-v2": "0".repeat(64) },
      secret,
      nowSeconds: now,
    });

    expect(result).toEqual({ isValid: false, method: null });
  });

  it("許容範囲(±300秒)を超えたタイムスタンプを拒否する", () => {
    const now = Math.floor(Date.now() / 1000);
    const staleTimestamp = now - 301;
    const body = bodyWithTimestamp(staleTimestamp);
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", secret)
      .update(stableStringify(body), "utf-8")
      .digest("hex");

    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature-v2": signature },
      secret,
      nowSeconds: now,
    });

    expect(result).toEqual({ isValid: false, method: null });
  });

  it("不正なJSON本文を拒否する", () => {
    const result = verifyWebhookSignature({
      rawBody: "not json",
      headers: { "x-signature-v2": "irrelevant" },
      secret,
    });

    expect(result).toEqual({ isValid: false, method: null });
  });

  it("署名ヘッダーが1つもなければ拒否する", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = verifyWebhookSignature({
      rawBody: JSON.stringify(bodyWithTimestamp(now)),
      headers: {},
      secret,
      nowSeconds: now,
    });

    expect(result).toEqual({ isValid: false, method: null });
  });
});
