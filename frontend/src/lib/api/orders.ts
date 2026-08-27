import { api } from "@/lib/api";

export type ShippingAddressInput = {
  recipientName: string;
  postalCode: string;
  prefecture: string;
  city: string;
  addressLine1: string;
  addressLine2: string | null;
  phoneNumber: string;
};

export type OrderSummary = {
  id: string;
  listingId: string;
  cardId: string;
  buyerId: string;
  sellerId: string;
  priceMinor: string;
  currency: string;
  status: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  createdAt: string;
  listingTitle: string;
  cardName: string;
  buyerDisplayName: string;
  sellerDisplayName: string;
  shipment: {
    carrier: string;
    carrierNameOther: string | null;
    trackingNumber: string;
    shippedAt: string;
    deliveredAt: string | null;
  } | null;
};

export type OrderDetail = OrderSummary & {
  viewerRole: "buyer" | "seller";
  shippingAddress: ShippingAddressInput | null;
  auditAnchors: {
    eventType: string;
    occurredAt: string;
    payloadSha256: string;
    outboxStatus: string | null;
    txHash: string | null;
  }[];
};

export type PaymentIntent = {
  id: string;
  orderId: string;
  status: "created" | "submitted" | "confirmed" | "failed" | "expired";
  chainId: number;
  tokenAddress: `0x${string}`;
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountAtomic: string;
  tokenDecimals: number;
  txHash: `0x${string}` | null;
  blockNumber: string | null;
  expiresAt: string;
  lastErrorCode: string | null;
};

export function createOrder(
  token: string,
  input: { listingId: string; shippingAddress: ShippingAddressInput },
): Promise<{ id: string }> {
  return api(
    "/api/v1/orders",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function fetchOrders(
  token: string,
  role: "buyer" | "seller",
): Promise<{ items: OrderSummary[] }> {
  return api(`/api/v1/orders?role=${role}`, {}, token);
}

export function fetchOrderDetail(
  token: string,
  orderId: string,
): Promise<OrderDetail> {
  return api(`/api/v1/orders/${encodeURIComponent(orderId)}`, {}, token);
}

export function createPaymentIntent(
  token: string,
  orderId: string,
): Promise<PaymentIntent> {
  return api(
    "/api/v1/payments",
    { method: "POST", body: JSON.stringify({ orderId }) },
    token,
  );
}

export function submitPaymentTransaction(
  token: string,
  paymentIntentId: string,
  txHash: string,
): Promise<PaymentIntent> {
  return api(
    `/api/v1/payments/${encodeURIComponent(paymentIntentId)}/submissions`,
    { method: "POST", body: JSON.stringify({ txHash }) },
    token,
  );
}

export function fetchPaymentIntent(
  token: string,
  paymentIntentId: string,
): Promise<PaymentIntent> {
  return api(
    `/api/v1/payments/${encodeURIComponent(paymentIntentId)}`,
    {},
    token,
  );
}

export function registerShipment(
  token: string,
  orderId: string,
  input: {
    carrier: string;
    carrierNameOther?: string;
    trackingNumber: string;
  },
): Promise<{ shipped: boolean }> {
  return api(
    `/api/v1/orders/${encodeURIComponent(orderId)}/shipment`,
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export function confirmDelivery(
  token: string,
  orderId: string,
): Promise<{ completed: boolean }> {
  return api(
    `/api/v1/orders/${encodeURIComponent(orderId)}/delivery-confirmation`,
    { method: "POST" },
    token,
  );
}

export const CARRIER_LABELS: Record<string, string> = {
  yamato: "ヤマト運輸",
  sagawa: "佐川急便",
  japan_post: "日本郵便",
  other: "その他",
};

/** キャリア公式の追跡ページ(番号は利用者がコピーして入力する) */
export const CARRIER_TRACKING_URLS: Record<string, string> = {
  yamato: "https://toi.kuronekoyamato.co.jp/cgi-bin/tneko",
  sagawa: "https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do",
  japan_post: "https://trackings.post.japanpost.jp/services/srv/search/",
};


export function cancelOrder(
  token: string,
  orderId: string,
): Promise<{ cancelled: boolean }> {
  return api(
    `/api/v1/orders/${encodeURIComponent(orderId)}/cancellation`,
    { method: "POST" },
    token,
  );
}

export type DisputeReasonCode =
  | "not_delivered"
  | "not_as_described"
  | "suspected_fake"
  | "other";

export const DISPUTE_REASON_LABELS: Record<DisputeReasonCode, string> = {
  not_delivered: "商品が届かない",
  not_as_described: "商品が説明と異なる",
  suspected_fake: "偽物の疑いがある",
  other: "その他",
};

export function openDispute(
  token: string,
  orderId: string,
  input: { reasonCode: DisputeReasonCode; description: string },
): Promise<{ disputed: boolean }> {
  return api(
    `/api/v1/orders/${encodeURIComponent(orderId)}/dispute`,
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}
