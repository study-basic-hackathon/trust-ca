import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  createAuditAnchor,
  getAuditAnchor,
  IdempotencyConflictError,
} from "../db/onchain-outbox.js";
import type { OnchainConfig } from "../env.js";
import type { JsonValue } from "../services/canonical-json.js";

type Dependencies = {
  pool: Pool;
  config: OnchainConfig;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{11,127}$/;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_PAYLOAD_DEPTH = 32;

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return secureEqual(header.slice(7), expectedToken);
}

function isJsonValue(value: unknown, depth: number): value is JsonValue {
  if (depth > MAX_PAYLOAD_DEPTH) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1));
  }
  if (typeof value !== "object") return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value, 0)
  );
}

function publicRecord(record: Awaited<ReturnType<typeof getAuditAnchor>>) {
  if (!record) return null;
  return {
    auditEventId: record.auditEventId,
    status: record.status,
    chainId: record.chainId,
    contractAddress: record.contractAddress,
    payloadSha256: record.payloadSha256,
    attemptCount: record.attemptCount,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    lastErrorCode: record.lastErrorCode,
  };
}

export function createOnchainAnchorRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  const authorize = async (
    c: Parameters<Parameters<typeof route.use>[1]>[0],
    next: Parameters<Parameters<typeof route.use>[1]>[1],
  ) => {
    if (!dependencies.config.enabled) {
      return c.json(
        { error: { code: "ONCHAIN_MVP_DISABLED", message: "非同期オンチェーン記録機能は現在無効です。" } },
        503,
      );
    }
    if (
      !isAuthorized(
        c.req.header("authorization"),
        dependencies.config.internalToken,
      )
    ) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "内部APIの認証に失敗しました。" } },
        401,
      );
    }
    await next();
  };

  route.use("/api/v1/internal/onchain-anchors", authorize);
  route.use("/api/v1/internal/onchain-anchors/*", authorize);

  route.post("/api/v1/internal/onchain-anchors", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { code: "INVALID_REQUEST_BODY", message: "JSON形式の本文を指定してください。" } },
        400,
      );
    }
    if (!isJsonObject(body)) {
      return c.json(
        { error: { code: "INVALID_REQUEST_BODY", message: "リクエスト本文はJSONオブジェクトで指定してください。" } },
        400,
      );
    }

    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    const aggregateType =
      typeof body.aggregateType === "string" ? body.aggregateType : "";
    const aggregateId =
      typeof body.aggregateId === "string" ? body.aggregateId : "";
    const eventType = typeof body.eventType === "string" ? body.eventType : "";
    const eventVersion =
      typeof body.eventVersion === "number" ? body.eventVersion : 1;
    const occurredAtValue =
      typeof body.occurredAt === "string" ? body.occurredAt : "";
    const occurredAt = new Date(occurredAtValue);
    const payload = body.payload;

    if (
      !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey) ||
      !NAME_PATTERN.test(aggregateType) ||
      !UUID_PATTERN.test(aggregateId) ||
      !NAME_PATTERN.test(eventType) ||
      !Number.isSafeInteger(eventVersion) ||
      eventVersion < 1 ||
      Number.isNaN(occurredAt.getTime()) ||
      !isJsonObject(payload) ||
      Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_AUDIT_EVENT",
            message: "監査イベントの入力値が仕様を満たしていません。",
          },
        },
        400,
      );
    }

    try {
      const record = await createAuditAnchor(dependencies.pool, {
        idempotencyKey,
        aggregateType,
        aggregateId,
        eventType,
        eventVersion,
        occurredAt,
        payload,
        chainId: dependencies.config.chainId,
        contractAddress: dependencies.config.contractAddress,
      });
      return c.json(
        { data: { ...publicRecord(record), created: record.created } },
        record.created ? 202 : 200,
      );
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return c.json(
          { error: { code: "IDEMPOTENCY_CONFLICT", message: error.message } },
          409,
        );
      }
      console.error("監査イベントのoutbox登録に失敗しました。");
      return c.json(
        { error: { code: "OUTBOX_CREATE_FAILED", message: "非同期処理の登録に失敗しました。" } },
        500,
      );
    }
  });

  route.get("/api/v1/internal/onchain-anchors/:auditEventId", async (c) => {
    const auditEventId = c.req.param("auditEventId");
    if (!UUID_PATTERN.test(auditEventId)) {
      return c.json(
        { error: { code: "INVALID_AUDIT_EVENT_ID", message: "監査イベントIDの形式が不正です。" } },
        400,
      );
    }
    const record = await getAuditAnchor(dependencies.pool, auditEventId);
    if (!record) {
      return c.json(
        { error: { code: "AUDIT_EVENT_NOT_FOUND", message: "監査イベントが見つかりません。" } },
        404,
      );
    }
    return c.json({ data: publicRecord(record) });
  });

  return route;
}
