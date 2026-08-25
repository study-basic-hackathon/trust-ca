import { Hono } from "hono";
import type { Pool } from "pg";
import {
  confirmDelivery,
  createOrderFromListing,
  getOrderViewById,
  getShippingAddress,
  listOrderAuditAnchors,
  listOrdersForUser,
  OrderRepositoryError,
  registerShipment,
  type OrderView,
  type ShippingAddressInput,
} from "../db/orders.js";
import type { OnchainConfig, PaymentConfig } from "../env.js";
import {
  resolveWalletSession,
  UNAUTHORIZED_RESPONSE,
} from "../middleware/wallet-session.js";

type Dependencies = {
  pool: Pool;
  walletConfig: PaymentConfig;
  onchainConfig: OnchainConfig;
};

const SHIPPING_RETENTION_DAYS = 90;
const CARRIERS = new Set(["yamato", "sagawa", "japan_post", "other"]);
const TRACKING_NUMBER_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ShippingAddressValidationError extends Error {}

function requiredText(
  value: unknown,
  maxLength: number,
  label: string,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw new ShippingAddressValidationError(
      `${label}は1〜${maxLength}文字で入力してください。`,
    );
  }
  return text;
}

function parseShippingAddress(value: unknown): ShippingAddressInput {
  if (!isRecord(value)) {
    throw new ShippingAddressValidationError("配送先を入力してください。");
  }
  const postalCode =
    typeof value.postalCode === "string"
      ? value.postalCode.trim().replace(/^(\d{3})(\d{4})$/, "$1-$2")
      : "";
  if (!/^\d{3}-\d{4}$/.test(postalCode)) {
    throw new ShippingAddressValidationError(
      "郵便番号はNNN-NNNN形式で入力してください。",
    );
  }
  const phoneNumber =
    typeof value.phoneNumber === "string"
      ? value.phoneNumber.trim().replace(/[^\d-]/g, "")
      : "";
  if (!/^[0-9-]{10,15}$/.test(phoneNumber)) {
    throw new ShippingAddressValidationError(
      "電話番号は数字とハイフンで入力してください。",
    );
  }
  const addressLine2 =
    typeof value.addressLine2 === "string" && value.addressLine2.trim()
      ? value.addressLine2.trim().slice(0, 200)
      : null;
  return {
    recipientName: requiredText(value.recipientName, 100, "受取人氏名"),
    postalCode,
    prefecture: requiredText(value.prefecture, 20, "都道府県"),
    city: requiredText(value.city, 100, "市区町村"),
    addressLine1: requiredText(value.addressLine1, 200, "番地・建物"),
    addressLine2,
    phoneNumber,
  };
}

function toOrderResponse(order: OrderView) {
  return {
    id: order.id,
    listingId: order.listingId,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    priceMinor: order.priceMinor,
    currency: order.currency,
    status: order.status,
    paidAt: order.paidAt?.toISOString() ?? null,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    listingTitle: order.listingTitle,
    cardName: order.cardName,
    buyerDisplayName: order.buyerDisplayName,
    sellerDisplayName: order.sellerDisplayName,
    shipment: order.shipment
      ? {
          carrier: order.shipment.carrier,
          carrierNameOther: order.shipment.carrierNameOther,
          trackingNumber: order.shipment.trackingNumber,
          shippedAt: order.shipment.shippedAt.toISOString(),
          deliveredAt: order.shipment.deliveredAt?.toISOString() ?? null,
        }
      : null,
  };
}

function conflictStatus(error: OrderRepositoryError): 403 | 404 | 409 {
  switch (error.code) {
    case "SELF_PURCHASE_FORBIDDEN":
      return 403;
    case "LISTING_NOT_AVAILABLE":
      return 409;
    default:
      return 409;
  }
}

/**
 * 注文・発送・受領確認API(api-catalog.md §6.5、shipping-flow.md §4)。
 * 参照は取引当事者のみ。配送先PIIは当事者と運営者以外へ返さない。
 */
export function createOrdersRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.post("/api/v1/orders", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.listingId !== "string") {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST_BODY",
            message: "listingIdを含むリクエスト本文を指定してください。",
          },
        },
        400,
      );
    }
    let shippingAddress: ShippingAddressInput;
    try {
      shippingAddress = parseShippingAddress(body.shippingAddress);
    } catch (error) {
      return c.json(
        {
          error: {
            code: "INVALID_SHIPPING_ADDRESS",
            message:
              error instanceof ShippingAddressValidationError
                ? error.message
                : "配送先を確認してください。",
          },
        },
        400,
      );
    }

    try {
      const { orderId } = await createOrderFromListing(dependencies.pool, {
        listingId: body.listingId,
        buyerId: session.userId,
        shippingAddress,
      });
      return c.json({ data: { id: orderId } }, 201);
    } catch (error) {
      if (error instanceof OrderRepositoryError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          conflictStatus(error),
        );
      }
      throw error;
    }
  });

  route.get("/api/v1/orders", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const role = c.req.query("role") === "seller" ? "seller" : "buyer";
    const orders = await listOrdersForUser(dependencies.pool, {
      userId: session.userId,
      role,
    });
    return c.json({ data: { items: orders.map(toOrderResponse) } });
  });

  route.get("/api/v1/orders/:orderId", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const order = await getOrderViewById(
      dependencies.pool,
      c.req.param("orderId"),
    );
    if (
      !order ||
      (order.buyerId !== session.userId && order.sellerId !== session.userId)
    ) {
      // 存在の秘匿のため、権限なしも404で返す
      return c.json(
        {
          error: { code: "ORDER_NOT_FOUND", message: "注文が見つかりません。" },
        },
        404,
      );
    }

    // 配送先PII: 発送作業に必要な期間(発送完了まで)は販売者にも開示する
    const isBuyer = order.buyerId === session.userId;
    const shouldIncludeAddress =
      isBuyer || ["paid", "shipped"].includes(order.status);
    const shippingAddress = shouldIncludeAddress
      ? await getShippingAddress(dependencies.pool, order.id)
      : null;
    const auditAnchors = await listOrderAuditAnchors(
      dependencies.pool,
      order.id,
    );

    return c.json({
      data: {
        ...toOrderResponse(order),
        viewerRole: isBuyer ? "buyer" : "seller",
        shippingAddress: shippingAddress
          ? {
              recipientName: shippingAddress.recipientName,
              postalCode: shippingAddress.postalCode,
              prefecture: shippingAddress.prefecture,
              city: shippingAddress.city,
              addressLine1: shippingAddress.addressLine1,
              addressLine2: shippingAddress.addressLine2,
              phoneNumber: shippingAddress.phoneNumber,
            }
          : null,
        auditAnchors: auditAnchors.map((anchor) => ({
          eventType: anchor.eventType,
          occurredAt: anchor.occurredAt.toISOString(),
          payloadSha256: anchor.payloadSha256,
          outboxStatus: anchor.outboxStatus,
          txHash: anchor.txHash,
        })),
      },
    });
  });

  route.post("/api/v1/orders/:orderId/shipment", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const carrier =
      isRecord(body) && typeof body.carrier === "string" ? body.carrier : "";
    const trackingNumber =
      isRecord(body) && typeof body.trackingNumber === "string"
        ? body.trackingNumber.trim()
        : "";
    const carrierNameOther =
      isRecord(body) &&
      typeof body.carrierNameOther === "string" &&
      body.carrierNameOther.trim()
        ? body.carrierNameOther.trim().slice(0, 100)
        : null;

    if (!CARRIERS.has(carrier) || (carrier === "other" && !carrierNameOther)) {
      return c.json(
        {
          error: {
            code: "INVALID_CARRIER",
            message: "配送業者を選択してください。",
          },
        },
        400,
      );
    }
    if (!TRACKING_NUMBER_PATTERN.test(trackingNumber)) {
      return c.json(
        {
          error: {
            code: "INVALID_TRACKING_NUMBER",
            message: "追跡番号は4〜64文字の英数字とハイフンで入力してください。",
          },
        },
        400,
      );
    }

    try {
      await registerShipment(dependencies.pool, {
        orderId: c.req.param("orderId"),
        sellerId: session.userId,
        carrier,
        carrierNameOther,
        trackingNumber,
        onchainConfig: dependencies.onchainConfig,
      });
      return c.json({ data: { shipped: true } });
    } catch (error) {
      if (error instanceof OrderRepositoryError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          409,
        );
      }
      throw error;
    }
  });

  route.post("/api/v1/orders/:orderId/delivery-confirmation", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }
    try {
      await confirmDelivery(dependencies.pool, {
        orderId: c.req.param("orderId"),
        buyerId: session.userId,
        retentionDays: SHIPPING_RETENTION_DAYS,
        onchainConfig: dependencies.onchainConfig,
      });
      return c.json({ data: { completed: true } });
    } catch (error) {
      if (error instanceof OrderRepositoryError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          409,
        );
      }
      throw error;
    }
  });

  return route;
}
