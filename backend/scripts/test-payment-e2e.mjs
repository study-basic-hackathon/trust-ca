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

async function authenticateBuyer() {
  const challenge = await request("/api/v1/wallet-auth/challenges", {
    method: "POST",
    body: JSON.stringify({ address: buyerAccount.address, chainId }),
  });
  assert.equal(challenge.response.status, 201, JSON.stringify(challenge.body));
  const signature = await buyerAccount.signMessage({
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
    buyerAccount.address.toLowerCase(),
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
  const session = await authenticateBuyer();
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
  console.log("Web3Auth/SIWE・JPYC決済E2Eに成功しました。");
} finally {
  await cleanupFixture();
  await pool.end();
}
