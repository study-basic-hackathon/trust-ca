import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8080";
const rpcUrl = process.env.PAYMENT_RPC_URL ?? "http://localhost:8545";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/trustca";
const chainId = Number(process.env.PAYMENT_CHAIN_ID ?? 31337);
const tokenAddress = (
  process.env.PAYMENT_JPYC_TOKEN_ADDRESS ??
  "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"
).toLowerCase();

const buyerAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
// Hardhat account #2(公開開発鍵)。発送登録のSIWE認証に使用する
const sellerAccount = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const sellerAddress = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const sellerId = randomUUID();
const sellerWalletId = randomUUID();
const cardId = randomUUID();
const listingId = randomUUID();
const orderId = randomUUID();

const chain = defineChain({
  id: chainId,
  name: "Trustca Local",
  nativeCurrency: { name: "Local Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({
  account: buyerAccount,
  chain,
  transport: http(rpcUrl),
});
const pool = new pg.Pool({ connectionString: databaseUrl });

const transferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

async function request(path, init = {}) {
  const response = await globalThis.fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  return { response, body };
}

async function authenticateWallet(account) {
  const challenge = await request("/api/v1/wallet-auth/challenges", {
    method: "POST",
    body: JSON.stringify({ address: account.address, chainId }),
  });
  assert.equal(challenge.response.status, 201, JSON.stringify(challenge.body));
  const signature = await account.signMessage({
    message: challenge.body.data.message,
  });
  const verification = await request("/api/v1/wallet-auth/verifications", {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.body.data.challengeId,
      message: challenge.body.data.message,
      signature,
    }),
  });
  assert.equal(
    verification.response.status,
    200,
    JSON.stringify(verification.body),
  );
  assert.equal(
    verification.body.data.walletAddress,
    account.address.toLowerCase(),
  );
  return verification.body.data;
}

async function createOrderFixture(buyerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, display_name) VALUES ($1, 'E2E販売者')`,
      [sellerId],
    );
    await client.query(
      `INSERT INTO seller_profiles (user_id, onboarding_status, approved_at)
       VALUES ($1, 'approved', CURRENT_TIMESTAMP)`,
      [sellerId],
    );
    await client.query(
      `INSERT INTO wallet_accounts (
         id, user_id, provider, chain_id, address_normalized, verified_at
       ) VALUES ($1, $2, 'local_e2e', $3, $4, CURRENT_TIMESTAMP)`,
      [sellerWalletId, sellerId, chainId, sellerAddress],
    );
    await client.query(
      `INSERT INTO cards (id, current_owner_id, name, status)
       VALUES ($1, $2, 'E2E検証用カード', 'verified')`,
      [cardId, sellerId],
    );
    await client.query(
      `INSERT INTO listings (
         id, card_id, seller_id, title, price_minor, currency, status, published_at
       ) VALUES ($1, $2, $3, 'E2E JPYC決済', 12000, 'JPY', 'reserved', CURRENT_TIMESTAMP)`,
      [listingId, cardId, sellerId],
    );
    await client.query(
      `INSERT INTO orders (
         id, listing_id, buyer_id, seller_id, status, price_minor, currency
       ) VALUES ($1, $2, $3, $4, 'pending_payment', 12000, 'JPY')`,
      [orderId, listingId, buyerId, sellerId],
    );
    await client.query(
      `INSERT INTO order_shipping_addresses (
         id, order_id, recipient_name, postal_code, prefecture, city,
         address_line1, phone_number
       ) VALUES ($1, $2, 'E2E受取人', '100-0001', '東京都', '千代田区',
                 '千代田1-1-1', '090-0000-0000')`,
      [randomUUID(), orderId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM payment_intents WHERE order_id = $1", [orderId]);
    await client.query(
      `DELETE FROM onchain_outbox
        WHERE audit_event_id IN (
          SELECT id FROM audit_events
           WHERE aggregate_type = 'order' AND aggregate_id = $1
        )`,
      [orderId],
    );
    await client.query(
      `DELETE FROM audit_events
        WHERE aggregate_type = 'order' AND aggregate_id = $1`,
      [orderId],
    );
    await client.query("DELETE FROM shipments WHERE order_id = $1", [orderId]);
    await client.query("DELETE FROM order_shipping_addresses WHERE order_id = $1", [orderId]);
    await client.query("DELETE FROM orders WHERE id = $1", [orderId]);
    await client.query("DELETE FROM listings WHERE id = $1", [listingId]);
    await client.query("DELETE FROM cards WHERE id = $1", [cardId]);
    await client.query("DELETE FROM wallet_accounts WHERE id = $1", [sellerWalletId]);
    await client.query("DELETE FROM seller_profiles WHERE user_id = $1", [sellerId]);
    await client.query("DELETE FROM users WHERE id = $1", [sellerId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("E2E fixtureの削除に失敗しました。", error);
  } finally {
    client.release();
  }
}

try {
  const session = await authenticateWallet(buyerAccount);
  console.log(`  OK: SIWE認証 user=${session.userId}`);
  await createOrderFixture(session.userId);

  const authorization = `Bearer ${session.token}`;
  const created = await request("/api/v1/payments", {
    method: "POST",
    headers: { authorization },
    body: JSON.stringify({ orderId }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const intent = created.body.data;
  assert.equal(intent.toAddress, sellerAddress);
  assert.equal(intent.fromAddress, buyerAccount.address.toLowerCase());
  assert.equal(intent.amountAtomic, (12_000n * 10n ** 18n).toString());
  console.log(`  OK: payment intent作成 id=${intent.id}`);

  await pool.query(
    `UPDATE payment_intents
        SET created_at = CURRENT_TIMESTAMP - interval '2 seconds',
            expires_at = CURRENT_TIMESTAMP - interval '1 second'
      WHERE id = $1`,
    [intent.id],
  );
  const expiredSubmission = await request(
    `/api/v1/payments/${intent.id}/submissions`,
    {
      method: "POST",
      headers: { authorization },
      body: JSON.stringify({ txHash: `0x${"f".repeat(64)}` }),
    },
  );
  assert.equal(
    expiredSubmission.response.status,
    409,
    JSON.stringify(expiredSubmission.body),
  );
  assert.equal(expiredSubmission.body.error.code, "PAYMENT_INTENT_EXPIRED");
  const expiredState = await pool.query(
    "SELECT status FROM payment_intents WHERE id = $1",
    [intent.id],
  );
  assert.equal(expiredState.rows[0].status, "expired");
  console.log("  OK: 期限切れintentをcommitし、tx登録を拒否");

  const renewed = await request("/api/v1/payments", {
    method: "POST",
    headers: { authorization },
    body: JSON.stringify({ orderId }),
  });
  assert.equal(renewed.response.status, 201, JSON.stringify(renewed.body));
  assert.notEqual(renewed.body.data.id, intent.id);
  const activeIntent = renewed.body.data;
  console.log(`  OK: 期限切れ後にintentを再作成 id=${activeIntent.id}`);

  const duplicate = await request("/api/v1/payments", {
    method: "POST",
    headers: { authorization },
    body: JSON.stringify({ orderId }),
  });
  assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.data.id, activeIntent.id);
  console.log("  OK: payment intent作成APIの冪等性");

  const txHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: transferAbi,
    functionName: "transfer",
    args: [sellerAddress, BigInt(activeIntent.amountAtomic)],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  const submitted = await request(`/api/v1/payments/${activeIntent.id}/submissions`, {
    method: "POST",
    headers: { authorization },
    body: JSON.stringify({ txHash }),
  });
  assert.equal(submitted.response.status, 202, JSON.stringify(submitted.body));
  console.log(`  OK: JPYC transfer登録 tx=${txHash}`);

  const deadline = Date.now() + 30_000;
  let current;
  while (Date.now() < deadline) {
    const result = await request(`/api/v1/payments/${activeIntent.id}`, {
      headers: { authorization },
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    current = result.body.data;
    if (current.status === "confirmed" || current.status === "failed") break;
    await sleep(500);
  }
  assert.equal(current?.status, "confirmed", JSON.stringify(current));
  assert.match(current.blockNumber, /^\d+$/);

  const state = await pool.query(
    `SELECT o.status AS order_status, l.status AS listing_status,
            p.status AS payment_status, p.tx_hash
       FROM orders o
      JOIN listings l ON l.id = o.listing_id
       JOIN payment_intents p ON p.order_id = o.id
      WHERE o.id = $1 AND p.id = $2`,
    [orderId, activeIntent.id],
  );
  assert.deepEqual(state.rows[0], {
    order_status: "paid",
    listing_status: "sold",
    payment_status: "confirmed",
    tx_hash: txHash.toLowerCase(),
  });
  console.log(`  OK: workerがblock ${current.blockNumber} で支払いを確定`);

  // ---- 発送・受領確認フロー(shipping-flow.md) ----
  const sellerSession = await authenticateWallet(sellerAccount);
  assert.equal(sellerSession.userId, sellerId);
  const sellerAuthorization = `Bearer ${sellerSession.token}`;

  const sellerOrderView = await request(`/api/v1/orders/${orderId}`, {
    headers: { authorization: sellerAuthorization },
  });
  assert.equal(sellerOrderView.response.status, 200);
  assert.equal(
    sellerOrderView.body.data.shippingAddress.recipientName,
    "E2E受取人",
    "発送前の販売者は配送先を参照できること",
  );

  const prematureDelivery = await request(
    `/api/v1/orders/${orderId}/delivery-confirmation`,
    { method: "POST", headers: { authorization } },
  );
  assert.equal(
    prematureDelivery.response.status,
    409,
    "未発送での受領確認は409であること",
  );

  const shipment = await request(`/api/v1/orders/${orderId}/shipment`, {
    method: "POST",
    headers: { authorization: sellerAuthorization },
    body: JSON.stringify({ carrier: "yamato", trackingNumber: "E2E-1234-5678" }),
  });
  assert.equal(shipment.response.status, 200, JSON.stringify(shipment.body));
  console.log("  OK: 発送登録(paid→shipped)");

  const duplicateShipment = await request(`/api/v1/orders/${orderId}/shipment`, {
    method: "POST",
    headers: { authorization: sellerAuthorization },
    body: JSON.stringify({ carrier: "yamato", trackingNumber: "E2E-9999-0000" }),
  });
  assert.equal(
    duplicateShipment.response.status,
    409,
    "二重の発送登録は409であること",
  );

  const delivery = await request(
    `/api/v1/orders/${orderId}/delivery-confirmation`,
    { method: "POST", headers: { authorization } },
  );
  assert.equal(delivery.response.status, 200, JSON.stringify(delivery.body));
  console.log("  OK: 受領確認(shipped→completed)");

  const finalState = await pool.query(
    `SELECT o.status AS order_status, s.delivered_at, a.retention_until
       FROM orders o
       JOIN shipments s ON s.order_id = o.id
       JOIN order_shipping_addresses a ON a.order_id = o.id
      WHERE o.id = $1`,
    [orderId],
  );
  assert.equal(finalState.rows[0].order_status, "completed");
  assert.ok(finalState.rows[0].delivered_at, "shipments.delivered_atが設定されること");
  assert.ok(
    finalState.rows[0].retention_until,
    "配送先のretention_untilが設定されること",
  );

  const auditEvents = await pool.query(
    `SELECT event_type FROM audit_events
      WHERE aggregate_type = 'order' AND aggregate_id = $1
      ORDER BY occurred_at`,
    [orderId],
  );
  assert.deepEqual(
    auditEvents.rows.map((row) => row.event_type),
    ["order.paid", "order.shipped", "order.completed"],
    "注文の監査イベントが3件記録されること",
  );
  console.log("  OK: 監査イベント(order.paid/shipped/completed)を確認");
  console.log("SIWE認証・JPYC決済・発送・受領確認のE2Eに成功しました。");
} finally {
  await cleanupFixture();
  await pool.end();
}
