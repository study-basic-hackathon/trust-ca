import { describe, expect, test } from "vitest";
import { createHmac } from "node:crypto";
import {
  stableStringify,
  shortenFloats,
  verifyWebhookSignature,
} from "@/lib/didit/signature";

const SECRET = "test-webhook-secret";

const basePayload = {
  session_id: "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  status: "Approved",
  webhook_type: "status.updated",
  created_at: 1_754_100_000,
  vendor_data: "seller_123",
  decision: { score: 1.0, note: "日本語テキスト" },
};

function hmacHex(input: string): string {
  return createHmac("sha256", SECRET).update(input, "utf-8").digest("hex");
}

function signV2(payload: unknown): string {
  return hmacHex(stableStringify(shortenFloats(payload)));
}

function signSimple(payload: typeof basePayload): string {
  return hmacHex(
    [
      String(payload.created_at),
      payload.session_id,
      payload.status,
      payload.webhook_type,
    ].join(":"),
  );
}

function signRaw(rawBody: string): string {
  return createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

describe("stableStringify", () => {
  test("sorts object keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  test("handles arrays, null, and primitives", () => {
    expect(stableStringify([1, "x", null, { b: 1, a: 2 }])).toBe(
      '[1,"x",null,{"a":2,"b":1}]',
    );
    expect(stableStringify(null)).toBe("null");
  });
});

describe("shortenFloats", () => {
  test("converts integer-valued floats to integers", () => {
    expect(JSON.stringify(shortenFloats({ score: 1.0, ratio: 0.5 }))).toBe(
      '{"score":1,"ratio":0.5}',
    );
  });

  test("recurses into arrays and nested objects", () => {
    expect(JSON.stringify(shortenFloats([2.0, { a: 3.0 }, null]))).toBe(
      "[2,{\"a\":3},null]",
    );
  });
});

describe("verifyWebhookSignature", () => {
  const now = basePayload.created_at + 10;

  test("accepts a valid X-Signature-V2", () => {
    const rawBody = JSON.stringify(basePayload);
    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature-v2": signV2(basePayload) },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ isValid: true, method: "v2" });
  });

  test("accepts V2 even when middleware re-encoded the JSON body", () => {
    // Same data, different key order and whitespace than what was signed
    const reEncoded = JSON.stringify({
      vendor_data: basePayload.vendor_data,
      status: basePayload.status,
      session_id: basePayload.session_id,
      webhook_type: basePayload.webhook_type,
      decision: basePayload.decision,
      created_at: basePayload.created_at,
    });
    const result = verifyWebhookSignature({
      rawBody: reEncoded,
      headers: { "x-signature-v2": signV2(basePayload) },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ isValid: true, method: "v2" });
  });

  test("falls back to X-Signature-Simple when V2 is absent", () => {
    const rawBody = JSON.stringify(basePayload);
    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature-simple": signSimple(basePayload) },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ isValid: true, method: "simple" });
  });

  test("falls back to raw X-Signature as a last resort", () => {
    const rawBody = JSON.stringify(basePayload);
    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature": signRaw(rawBody) },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ isValid: true, method: "raw" });
  });

  test("rejects a tampered payload", () => {
    const tampered = { ...basePayload, status: "Declined" };
    const result = verifyWebhookSignature({
      rawBody: JSON.stringify(tampered),
      headers: {
        "x-signature-v2": signV2(basePayload),
        "x-signature-simple": signSimple(basePayload),
        "x-signature": signRaw(JSON.stringify(basePayload)),
      },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result.isValid).toBe(false);
  });

  test("rejects a signature made with the wrong secret", () => {
    const rawBody = JSON.stringify(basePayload);
    const wrongSig = createHmac("sha256", "wrong-secret")
      .update(stableStringify(shortenFloats(basePayload)), "utf-8")
      .digest("hex");
    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature-v2": wrongSig },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result.isValid).toBe(false);
  });

  test("rejects a stale timestamp beyond the 300s tolerance", () => {
    const rawBody = JSON.stringify(basePayload);
    const result = verifyWebhookSignature({
      rawBody,
      headers: { "x-signature-v2": signV2(basePayload) },
      secret: SECRET,
      nowSeconds: basePayload.created_at + 301,
    });
    expect(result.isValid).toBe(false);
  });

  test("rejects when no signature header is present", () => {
    const result = verifyWebhookSignature({
      rawBody: JSON.stringify(basePayload),
      headers: {},
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ isValid: false, method: null });
  });

  test("rejects unparseable JSON bodies", () => {
    const result = verifyWebhookSignature({
      rawBody: "not-json{",
      headers: { "x-signature-v2": "deadbeef" },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result.isValid).toBe(false);
  });

  test("rejects malformed (non-hex) signature values without throwing", () => {
    const result = verifyWebhookSignature({
      rawBody: JSON.stringify(basePayload),
      headers: { "x-signature-v2": "zz-not-hex" },
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result.isValid).toBe(false);
  });
});
