import { createHmac, timingSafeEqual } from "node:crypto";

const TIMESTAMP_TOLERANCE_SECONDS = 300;

export type SignatureMethod = "v2" | "simple" | "raw";

export type SignatureVerificationResult = {
  isValid: boolean;
  method: SignatureMethod | null;
};

type WebhookHeaders = {
  "x-signature"?: string | null;
  "x-signature-v2"?: string | null;
  "x-signature-simple"?: string | null;
};

/**
 * Didit's backend signs integer-valued floats as integers (Python's
 * json.dumps renders 1.0 differently than JS). Mirror that before signing.
 */
export function shortenFloats(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(shortenFloats);
  }
  if (typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => [
        key,
        shortenFloats(value),
      ]),
    );
  }
  return data;
}

/**
 * JSON stringify with recursively sorted keys, matching Python's
 * json.dumps(..., sort_keys=True, separators=(",", ":")).
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const parts = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(
            (value as Record<string, unknown>)[key],
          )}`,
      );
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

function hmacSha256Hex(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input, "utf-8").digest("hex");
}

function safeCompareHex(expectedHex: string, receivedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(receivedHex)) {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function isTimestampFresh(createdAt: unknown, nowSeconds: number): boolean {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    return false;
  }
  return Math.abs(nowSeconds - createdAt) <= TIMESTAMP_TOLERANCE_SECONDS;
}

/**
 * Verify a Didit webhook against all three documented signature schemes,
 * in order of preference: V2 (sorted-keys JSON), Simple (core fields),
 * then the raw-body signature.
 */
export function verifyWebhookSignature(input: {
  rawBody: string;
  headers: WebhookHeaders;
  secret: string;
  nowSeconds?: number;
}): SignatureVerificationResult {
  const {
    rawBody,
    headers,
    secret,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = input;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { isValid: false, method: null };
  }

  if (!isTimestampFresh(body.created_at, nowSeconds)) {
    return { isValid: false, method: null };
  }

  const signatureV2 = headers["x-signature-v2"];
  if (signatureV2) {
    const expected = hmacSha256Hex(secret, stableStringify(shortenFloats(body)));
    if (safeCompareHex(expected, signatureV2)) {
      return { isValid: true, method: "v2" };
    }
  }

  const signatureSimple = headers["x-signature-simple"];
  if (signatureSimple) {
    const canonical = [
      String(body.created_at ?? ""),
      String(body.session_id ?? ""),
      String(body.status ?? ""),
      String(body.webhook_type ?? ""),
    ].join(":");
    const expected = hmacSha256Hex(secret, canonical);
    if (safeCompareHex(expected, signatureSimple)) {
      return { isValid: true, method: "simple" };
    }
  }

  const signatureRaw = headers["x-signature"];
  if (signatureRaw) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (safeCompareHex(expected, signatureRaw)) {
      return { isValid: true, method: "raw" };
    }
  }

  return { isValid: false, method: null };
}
