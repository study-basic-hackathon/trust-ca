import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OnchainConfig } from "../env.js";
import { appendAuditAnchorOnClient } from "./onchain-outbox.js";

export type OrderStatus =
  | "pending_payment"
  | "payment_submitted"
  | "paid"
  | "shipped"
  | "delivered"
  | "completed"
  | "cancelled"
  | "disputed"
  | "refunded";

export type ShippingAddressInput = {
  recipientName: string;
  postalCode: string;
  prefecture: string;
  city: string;
  addressLine1: string;
  addressLine2: string | null;
  phoneNumber: string;
};

export type OrderView = {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  priceMinor: string;
  currency: string;
  status: OrderStatus;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  listingTitle: string;
  cardName: string;
  buyerDisplayName: string;
  sellerDisplayName: string;
  shipment: {
    carrier: string;
    carrierNameOther: string | null;
    trackingNumber: string;
    shippedAt: Date;
    deliveredAt: Date | null;
  } | null;
};

export class OrderRepositoryError extends Error {
  constructor(
    public readonly code:
      | "LISTING_NOT_AVAILABLE"
      | "SELF_PURCHASE_FORBIDDEN"
      | "ORDER_STATE_CONFLICT"
      | "SHIPMENT_ALREADY_REGISTERED",
    message: string,
  ) {
    super(message);
    this.name = "OrderRepositoryError";
  }
}

async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function toOrderView(row: Record<string, unknown>): OrderView {
  const toDate = (value: unknown): Date | null =>
    value ? new Date(String(value)) : null;
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    buyerId: String(row.buyer_id),
    sellerId: String(row.seller_id),
    priceMinor: String(row.price_minor),
    currency: String(row.currency),
    status: String(row.status) as OrderStatus,
    paidAt: toDate(row.paid_at),
    shippedAt: toDate(row.shipped_at),
    deliveredAt: toDate(row.delivered_at),
    completedAt: toDate(row.completed_at),
    createdAt: new Date(String(row.created_at)),
    listingTitle: String(row.listing_title),
    cardName: String(row.card_name),
    buyerDisplayName: String(row.buyer_display_name),
    sellerDisplayName: String(row.seller_display_name),
    shipment: row.shipment_tracking_number
      ? {
          carrier: String(row.shipment_carrier),
          carrierNameOther: row.shipment_carrier_name_other
            ? String(row.shipment_carrier_name_other)
            : null,
          trackingNumber: String(row.shipment_tracking_number),
          shippedAt: new Date(String(row.shipment_shipped_at)),
          deliveredAt: toDate(row.shipment_delivered_at),
        }
      : null,
  };
}

const SELECT_ORDER_VIEW = `
  SELECT o.id, o.listing_id, o.buyer_id, o.seller_id, o.price_minor,
         o.currency, o.status, o.paid_at, o.shipped_at, o.delivered_at,
         o.completed_at, o.created_at,
         l.title AS listing_title,
         c.name AS card_name,
         bu.display_name AS buyer_display_name,
         su.display_name AS seller_display_name,
         s.carrier AS shipment_carrier,
         s.carrier_name_other AS shipment_carrier_name_other,
         s.tracking_number AS shipment_tracking_number,
         s.shipped_at AS shipment_shipped_at,
         s.delivered_at AS shipment_delivered_at
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    JOIN cards c ON c.id = l.card_id
    JOIN users bu ON bu.id = o.buyer_id
    JOIN users su ON su.id = o.seller_id
    LEFT JOIN shipments s ON s.order_id = o.id`;

/**
 * 注文作成: listingをactive→reservedへ予約し、価格snapshotと配送先を
 * 同一transactionで保存する。reserve競合は409相当のエラー。
 */
export async function createOrderFromListing(
  pool: Pool,
  input: {
    listingId: string;
    buyerId: string;
    shippingAddress: ShippingAddressInput;
  },
): Promise<{ orderId: string }> {
  return withTransaction(pool, async (client) => {
    const reserveResult = await client.query(
      `UPDATE listings
          SET status = 'reserved'
        WHERE id = $1 AND status = 'active'
      RETURNING id, seller_id, price_minor, currency`,
      [input.listingId],
    );
    const listing = reserveResult.rows[0];
    if (!listing) {
      throw new OrderRepositoryError(
        "LISTING_NOT_AVAILABLE",
        "この商品は現在購入できません。他の方が取引手続き中の可能性があります。",
      );
    }
    if (listing.seller_id === input.buyerId) {
      throw new OrderRepositoryError(
        "SELF_PURCHASE_FORBIDDEN",
        "自分の出品は購入できません。",
      );
    }

    const orderId = randomUUID();
    await client.query(
      `INSERT INTO orders
         (id, listing_id, buyer_id, seller_id, price_minor, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_payment')`,
      [
        orderId,
        input.listingId,
        input.buyerId,
        listing.seller_id,
        listing.price_minor,
        listing.currency,
      ],
    );
    await client.query(
      `INSERT INTO order_shipping_addresses
         (id, order_id, recipient_name, postal_code, prefecture, city,
          address_line1, address_line2, phone_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        orderId,
        input.shippingAddress.recipientName,
        input.shippingAddress.postalCode,
        input.shippingAddress.prefecture,
        input.shippingAddress.city,
        input.shippingAddress.addressLine1,
        input.shippingAddress.addressLine2,
        input.shippingAddress.phoneNumber,
      ],
    );
    return { orderId };
  });
}

export async function getOrderViewById(
  pool: Pool,
  orderId: string,
): Promise<OrderView | null> {
  const result = await pool.query(`${SELECT_ORDER_VIEW} WHERE o.id = $1`, [
    orderId,
  ]);
  return result.rows[0] ? toOrderView(result.rows[0]) : null;
}

export async function listOrdersForUser(
  pool: Pool,
  input: { userId: string; role: "buyer" | "seller" },
): Promise<OrderView[]> {
  const column = input.role === "buyer" ? "o.buyer_id" : "o.seller_id";
  const result = await pool.query(
    `${SELECT_ORDER_VIEW}
      WHERE ${column} = $1
      ORDER BY o.created_at DESC`,
    [input.userId],
  );
  return result.rows.map(toOrderView);
}

/** 運営者向け全取引一覧(状態フィルタ任意)。 */
export async function listOrdersForAdmin(
  pool: Pool,
  options: { status: string | null; limit: number },
): Promise<OrderView[]> {
  const params: unknown[] = [];
  let condition = "";
  if (options.status) {
    params.push(options.status);
    condition = `WHERE o.status = $${params.length}`;
  }
  params.push(options.limit);
  const result = await pool.query(
    `${SELECT_ORDER_VIEW}
      ${condition}
      ORDER BY o.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(toOrderView);
}

export async function getShippingAddress(
  pool: Pool,
  orderId: string,
): Promise<(ShippingAddressInput & { retentionUntil: Date | null }) | null> {
  const result = await pool.query(
    `SELECT recipient_name, postal_code, prefecture, city, address_line1,
            address_line2, phone_number, retention_until
       FROM order_shipping_addresses
      WHERE order_id = $1`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    recipientName: String(row.recipient_name),
    postalCode: String(row.postal_code),
    prefecture: String(row.prefecture),
    city: String(row.city),
    addressLine1: String(row.address_line1),
    addressLine2: row.address_line2 ? String(row.address_line2) : null,
    phoneNumber: String(row.phone_number),
    retentionUntil: row.retention_until
      ? new Date(String(row.retention_until))
      : null,
  };
}

/** 注文に紐づく監査イベント(anchor状態込み)。PIIは含まれない。 */
export async function listOrderAuditAnchors(
  pool: Pool,
  orderId: string,
): Promise<
  {
    eventType: string;
    occurredAt: Date;
    payloadSha256: string;
    outboxStatus: string | null;
    txHash: string | null;
  }[]
> {
  const result = await pool.query(
    `SELECT a.event_type, a.occurred_at, a.payload_sha256,
            o.status AS outbox_status, o.tx_hash
       FROM audit_events a
       LEFT JOIN onchain_outbox o ON o.audit_event_id = a.id
      WHERE a.aggregate_type = 'order' AND a.aggregate_id = $1
      ORDER BY a.occurred_at ASC`,
    [orderId],
  );
  return result.rows.map((row) => ({
    eventType: String(row.event_type),
    occurredAt: new Date(String(row.occurred_at)),
    payloadSha256: String(row.payload_sha256),
    outboxStatus: row.outbox_status ? String(row.outbox_status) : null,
    txHash: row.tx_hash ? String(row.tx_hash) : null,
  }));
}

/**
 * 発送登録: order paid→shipped + shipments作成 + 監査イベントを
 * 同一transactionで行う(shipping-flow.md §4)。
 */
export async function registerShipment(
  pool: Pool,
  input: {
    orderId: string;
    sellerId: string;
    carrier: string;
    carrierNameOther: string | null;
    trackingNumber: string;
    onchainConfig: Pick<
      OnchainConfig,
      "enabled" | "chainId" | "contractAddress"
    >;
  },
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const orderResult = await client.query(
      `UPDATE orders
          SET status = 'shipped', shipped_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND seller_id = $2 AND status = 'paid'
      RETURNING id`,
      [input.orderId, input.sellerId],
    );
    if (orderResult.rowCount !== 1) {
      throw new OrderRepositoryError(
        "ORDER_STATE_CONFLICT",
        "発送登録できません。注文が支払い済み状態でないか、権限がありません。",
      );
    }
    try {
      await client.query(
        `INSERT INTO shipments
           (id, order_id, carrier, carrier_name_other, tracking_number)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          input.orderId,
          input.carrier,
          input.carrierNameOther,
          input.trackingNumber,
        ],
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new OrderRepositoryError(
          "SHIPMENT_ALREADY_REGISTERED",
          "この注文の発送は既に登録されています。",
        );
      }
      throw error;
    }
    if (input.onchainConfig.enabled) {
      // 追跡番号は準識別子のためpayloadへ含めない(shipping-flow.md §3.3)
      await appendAuditAnchorOnClient(client, {
        idempotencyKey: `order.shipped:${input.orderId}`,
        aggregateType: "order",
        aggregateId: input.orderId,
        eventType: "order.shipped",
        eventVersion: 1,
        occurredAt: new Date(),
        payload: { orderId: input.orderId, status: "shipped" },
        chainId: input.onchainConfig.chainId,
        contractAddress: input.onchainConfig.contractAddress,
      });
    }
  });
}

/**
 * 受領確認: shipped→delivered→completed を同一transactionで適用し、
 * 配送先の保持期限(完了から90日)を設定する。
 */
export async function confirmDelivery(
  pool: Pool,
  input: {
    orderId: string;
    buyerId: string;
    retentionDays: number;
    onchainConfig: Pick<
      OnchainConfig,
      "enabled" | "chainId" | "contractAddress"
    >;
  },
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const orderResult = await client.query(
      `UPDATE orders
          SET status = 'completed',
              delivered_at = CURRENT_TIMESTAMP,
              completed_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND buyer_id = $2 AND status = 'shipped'
      RETURNING id`,
      [input.orderId, input.buyerId],
    );
    if (orderResult.rowCount !== 1) {
      throw new OrderRepositoryError(
        "ORDER_STATE_CONFLICT",
        "受領確認できません。注文が発送済み状態でないか、権限がありません。",
      );
    }
    await client.query(
      `UPDATE shipments
          SET delivered_at = CURRENT_TIMESTAMP
        WHERE order_id = $1`,
      [input.orderId],
    );
    await client.query(
      `UPDATE order_shipping_addresses
          SET retention_until = CURRENT_TIMESTAMP + make_interval(days => $2)
        WHERE order_id = $1`,
      [input.orderId, input.retentionDays],
    );
    if (input.onchainConfig.enabled) {
      await appendAuditAnchorOnClient(client, {
        idempotencyKey: `order.completed:${input.orderId}`,
        aggregateType: "order",
        aggregateId: input.orderId,
        eventType: "order.completed",
        eventVersion: 1,
        occurredAt: new Date(),
        payload: { orderId: input.orderId, status: "completed" },
        chainId: input.onchainConfig.chainId,
        contractAddress: input.onchainConfig.contractAddress,
      });
    }
  });
}
