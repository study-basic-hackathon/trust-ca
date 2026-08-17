import { Hono } from "hono";
import type { Pool } from "pg";
import { isHash, type Hash } from "viem";
import {
  JpycPaymentClient,
  JpycPaymentError,
} from "../blockchain/jpyc-payment.js";
import {
  PaymentRepositoryError,
  type PaymentIntentRecord,
} from "../db/payments.js";
import type { PaymentConfig } from "../env.js";
import { PaymentService } from "../services/payment-service.js";
import {
  sessionFromAuthorization,
  type WalletSession,
} from "../services/session-token.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Dependencies = {
  pool: Pool;
  config: PaymentConfig;
  paymentClient?: JpycPaymentClient;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toResponse(record: PaymentIntentRecord) {
  return {
    id: record.id,
    orderId: record.orderId,
    status: record.status,
    chainId: record.chainId,
    tokenAddress: record.tokenAddress,
    fromAddress: record.fromAddress,
    toAddress: record.toAddress,
    amountAtomic: record.amountAtomic,
    tokenDecimals: record.tokenDecimals,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    expiresAt: record.expiresAt.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    lastErrorCode: record.lastErrorCode,
  };
}

function repositoryErrorStatus(error: PaymentRepositoryError): 400 | 403 | 404 | 409 {
  if (error.code === "ORDER_NOT_FOUND" || error.code === "PAYMENT_INTENT_NOT_FOUND") {
    return 404;
  }
  if (error.code === "PAYMENT_FORBIDDEN") return 403;
  if (
    error.code.endsWith("CONFLICT") ||
    error.code === "PAYMENT_TRANSACTION_ALREADY_USED" ||
    error.code === "ORDER_NOT_PAYABLE" ||
    error.code === "PAYMENT_INTENT_EXPIRED" ||
    error.code === "PAYMENT_INTENT_NOT_SUBMITTABLE"
  ) {
    return 409;
  }
  return 400;
}

export function createPaymentRoute(dependencies: Dependencies): Hono {
  const route = new Hono();
  const service = dependencies.config.enabled
    ? new PaymentService(
        dependencies.pool,
        dependencies.paymentClient ?? new JpycPaymentClient(dependencies.config),
        dependencies.config,
      )
    : null;

  async function authorize(header: string | undefined): Promise<WalletSession | null> {
    if (!dependencies.config.enabled) return null;
    return sessionFromAuthorization(header, dependencies.config);
  }

  route.use("/api/v1/payments/*", async (c, next) => {
    if (!dependencies.config.enabled || !service) {
      return c.json(
        {
          error: {
            code: "PAYMENT_MVP_DISABLED",
            message: "JPYC決済機能は現在無効です。",
          },
        },
        503,
      );
    }
    await next();
  });

  route.post("/api/v1/payments", async (c) => {
    if (!service) {
      return c.json(
        {
          error: {
            code: "PAYMENT_MVP_DISABLED",
            message: "JPYC決済機能は現在無効です。",
          },
        },
        503,
      );
    }
    const session = await authorize(c.req.header("authorization"));
    if (!session) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "wallet認証が必要です。" } },
        401,
      );
    }
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      typeof body.orderId !== "string" ||
      !UUID_PATTERN.test(body.orderId)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_PAYMENT_REQUEST",
            message: "有効な注文IDを指定してください。",
          },
        },
        400,
      );
    }
    try {
      const intent = await service.createIntent(body.orderId, session);
      return c.json({ data: toResponse(intent) }, intent.created ? 201 : 200);
    } catch (error) {
      if (error instanceof PaymentRepositoryError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          repositoryErrorStatus(error),
        );
      }
      if (error instanceof JpycPaymentError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          error.retryable ? 503 : 500,
        );
      }
      console.error("payment intentの作成に失敗しました。");
      return c.json(
        {
          error: {
            code: "PAYMENT_INTENT_CREATE_FAILED",
            message: "payment intentを作成できませんでした。",
          },
        },
        500,
      );
    }
  });

  route.post("/api/v1/payments/:id/submissions", async (c) => {
    if (!service) {
      return c.json(
        {
          error: {
            code: "PAYMENT_MVP_DISABLED",
            message: "JPYC決済機能は現在無効です。",
          },
        },
        503,
      );
    }
    const session = await authorize(c.req.header("authorization"));
    if (!session) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "wallet認証が必要です。" } },
        401,
      );
    }
    const paymentIntentId = c.req.param("id");
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !UUID_PATTERN.test(paymentIntentId) ||
      !isRecord(body) ||
      typeof body.txHash !== "string" ||
      !isHash(body.txHash)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_PAYMENT_SUBMISSION",
            message: "payment intent IDとtransaction hashを正しく指定してください。",
          },
        },
        400,
      );
    }
    try {
      const intent = await service.submitTransaction(
        paymentIntentId,
        body.txHash as Hash,
        session,
      );
      return c.json({ data: toResponse(intent) }, 202);
    } catch (error) {
      if (error instanceof PaymentRepositoryError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          repositoryErrorStatus(error),
        );
      }
      console.error("JPYC transactionの登録に失敗しました。");
      return c.json(
        {
          error: {
            code: "PAYMENT_SUBMISSION_FAILED",
            message: "transactionを登録できませんでした。",
          },
        },
        500,
      );
    }
  });

  route.get("/api/v1/payments/:id", async (c) => {
    if (!service) {
      return c.json(
        {
          error: {
            code: "PAYMENT_MVP_DISABLED",
            message: "JPYC決済機能は現在無効です。",
          },
        },
        503,
      );
    }
    const session = await authorize(c.req.header("authorization"));
    if (!session) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "wallet認証が必要です。" } },
        401,
      );
    }
    const paymentIntentId = c.req.param("id");
    if (!UUID_PATTERN.test(paymentIntentId)) {
      return c.json(
        { error: { code: "INVALID_PAYMENT_ID", message: "IDの形式が不正です。" } },
        400,
      );
    }
    const intent = await service.getIntent(paymentIntentId, session);
    if (!intent) {
      return c.json(
        {
          error: {
            code: "PAYMENT_INTENT_NOT_FOUND",
            message: "payment intentが見つかりません。",
          },
        },
        404,
      );
    }
    return c.json({ data: toResponse(intent) });
  });

  return route;
}
