import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  getMigrationStatus,
  quoteIdentifier,
  runMigrations,
} from "./lib/migrator.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(
  currentDirectory,
  "../src/db/migrations",
);
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URLまたはDATABASE_URLを指定してmigration統合テストを実行してください。",
  );
}

const schema = `trustca_migration_test_${process.pid}_${Date.now()}`;
const quotedSchema = quoteIdentifier(schema);
if (!schema.startsWith("trustca_migration_test_")) {
  throw new Error(`安全でない一時schema名です: ${schema}`);
}
const expectedTables = [
  "audit_events",
  "card_image_analyses",
  "card_images",
  "cards",
  "listings",
  "onchain_outbox",
  "orders",
  "payment_intents",
  "psa_verifications",
  "schema_migrations",
  "seller_limits",
  "seller_profiles",
  "seller_verifications",
  "users",
  "verification_events",
  "wallet_accounts",
  "wallet_auth_challenges",
  "webhook_events",
];

async function expectPostgresError(label, expectedCode, operation) {
  try {
    await operation();
  } catch (error) {
    if (error && typeof error === "object" && error.code === expectedCode) {
      console.log(`  OK: ${label}`);
      return;
    }
    throw error;
  }
  throw new Error(`${label}: PostgreSQL error ${expectedCode} が発生しませんでした`);
}

const cleanupClient = new Client({ connectionString });

try {
  console.log(`一時schema ${schema} でmigrationを検証します`);
  const concurrentRuns = await Promise.all([
    runMigrations({ connectionString, migrationsDirectory, schema }),
    runMigrations({ connectionString, migrationsDirectory, schema }),
  ]);
  assert.deepEqual(
    concurrentRuns.map((result) => result.applied.length).sort(),
    [0, 1],
    "同時実行時もmigrationは1回だけ適用されること",
  );
  console.log("  OK: advisory lockで同時実行を直列化");

  const secondRun = await runMigrations({
    connectionString,
    migrationsDirectory,
    schema,
  });
  assert.equal(secondRun.applied.length, 0, "2回目は適用件数0であること");
  console.log("  OK: migrationの再実行は変更なし");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    const tableResult = await client.query(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = $1
        ORDER BY tablename`,
      [schema],
    );
    assert.deepEqual(
      tableResult.rows.map((row) => row.tablename),
      expectedTables,
      "想定するtableがすべて作成されること",
    );
    console.log(`  OK: ${expectedTables.length} tableを確認`);

    const sellerId = randomUUID();
    const buyerId = randomUUID();
    await client.query(
      `INSERT INTO users (id, display_name, updated_at)
       VALUES ($1, '販売者', '2000-01-01T00:00:00Z'), ($2, '購入者', CURRENT_TIMESTAMP)`,
      [sellerId, buyerId],
    );
    const updatedUser = await client.query(
      `UPDATE users SET display_name = '販売者（更新）' WHERE id = $1
       RETURNING updated_at`,
      [sellerId],
    );
    assert.ok(
      new Date(updatedUser.rows[0].updated_at) > new Date("2000-01-01T00:00:00Z"),
      "updated_at triggerが時刻を更新すること",
    );
    console.log("  OK: updated_at triggerを確認");
    await client.query(
      `INSERT INTO seller_profiles (user_id, onboarding_status)
       VALUES ($1, 'approved')`,
      [sellerId],
    );

    await expectPostgresError("不正なwallet addressを拒否", "23514", () =>
      client.query(
        `INSERT INTO wallet_accounts
           (id, user_id, provider, chain_id, address_normalized, verified_at)
         VALUES ($1, $2, 'web3auth', 80002, 'invalid', CURRENT_TIMESTAMP)`,
        [randomUUID(), sellerId],
      ),
    );

    const walletAddress = `0x${"1".repeat(40)}`;
    const sellerAddress = `0x${"3".repeat(40)}`;
    const walletId = randomUUID();
    const sellerWalletId = randomUUID();
    await client.query(
      `INSERT INTO wallet_accounts
         (id, user_id, provider, chain_id, address_normalized, verified_at)
       VALUES ($1, $2, 'web3auth', 80002, $3, CURRENT_TIMESTAMP)`,
      [walletId, buyerId, walletAddress],
    );
    await expectPostgresError("walletの二重紐付けを拒否", "23505", () =>
      client.query(
        `INSERT INTO wallet_accounts
           (id, user_id, provider, chain_id, address_normalized, verified_at)
         VALUES ($1, $2, 'web3auth', 80002, $3, CURRENT_TIMESTAMP)`,
        [randomUUID(), sellerId, walletAddress],
      ),
    );
    await client.query(
      `INSERT INTO wallet_accounts
         (id, user_id, provider, chain_id, address_normalized, verified_at)
       VALUES ($1, $2, 'web3auth', 80002, $3, CURRENT_TIMESTAMP)`,
      [sellerWalletId, sellerId, sellerAddress],
    );

    const cardId = randomUUID();
    await client.query(
      `INSERT INTO cards (id, current_owner_id, psa_cert_number, name, status)
       VALUES ($1, $2, '12345678', 'テストカード', 'verified')`,
      [cardId, sellerId],
    );
    await expectPostgresError("PSA Certの二重利用を拒否", "23505", () =>
      client.query(
        `INSERT INTO cards (id, current_owner_id, psa_cert_number, name)
         VALUES ($1, $2, '12345678', '別のカード')`,
        [randomUUID(), sellerId],
      ),
    );

    const otherPsaVerificationId = randomUUID();
    await client.query(
      `INSERT INTO psa_verifications
         (id, cert_number, status, checked_at, expires_at)
       VALUES ($1, '87654321', 'verified', CURRENT_TIMESTAMP,
               CURRENT_TIMESTAMP + INTERVAL '1 day')`,
      [otherPsaVerificationId],
    );
    await expectPostgresError("カードと異なるCertのPSA結果参照を拒否", "23503", () =>
      client.query(
        `INSERT INTO cards
           (id, current_owner_id, psa_cert_number, latest_psa_verification_id, name)
         VALUES ($1, $2, '99999999', $3, '不整合カード')`,
        [randomUUID(), sellerId, otherPsaVerificationId],
      ),
    );

    const listingId = randomUUID();
    await client.query(
      `INSERT INTO listings
         (id, card_id, seller_id, title, price_minor, currency, status, published_at)
       VALUES ($1, $2, $3, 'テスト出品', 10000, 'JPY', 'active', CURRENT_TIMESTAMP)`,
      [listingId, cardId, sellerId],
    );
    await expectPostgresError("同一カードの多重出品を拒否", "23505", () =>
      client.query(
        `INSERT INTO listings
           (id, card_id, seller_id, title, price_minor, currency, status, published_at)
         VALUES ($1, $2, $3, '重複出品', 11000, 'JPY', 'active', CURRENT_TIMESTAMP)`,
        [randomUUID(), cardId, sellerId],
      ),
    );

    await client.query(
      `INSERT INTO seller_profiles (user_id, onboarding_status)
       VALUES ($1, 'approved')`,
      [buyerId],
    );
    await expectPostgresError("注文sellerとlisting sellerの不一致を拒否", "23503", () =>
      client.query(
        `INSERT INTO orders
           (id, listing_id, buyer_id, seller_id, price_minor, currency, status)
         VALUES ($1, $2, $3, $4, 10000, 'JPY', 'cancelled')`,
        [randomUUID(), listingId, sellerId, buyerId],
      ),
    );

    const orderId = randomUUID();
    await client.query(
      `INSERT INTO orders
         (id, listing_id, buyer_id, seller_id, price_minor, currency)
       VALUES ($1, $2, $3, $4, 10000, 'JPY')`,
      [orderId, listingId, buyerId, sellerId],
    );

    const tokenAddress = `0x${"2".repeat(40)}`;
    const txHash = `0x${"a".repeat(64)}`;
    await expectPostgresError("支払元walletとfrom addressの不一致を拒否", "23503", () =>
      client.query(
        `INSERT INTO payment_intents
           (id, order_id, payer_wallet_id, payee_wallet_id, chain_id,
            token_address_normalized, from_address_normalized,
            to_address_normalized, amount_atomic, token_decimals, status,
            expires_at)
         VALUES ($1, $2, $3, $4, 80002, $5, $6, $7, 10000, 18,
                 'created', CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [
          randomUUID(),
          orderId,
          walletId,
          sellerWalletId,
          tokenAddress,
          sellerAddress,
          walletAddress,
        ],
      ),
    );
    await expectPostgresError("submitted支払いのtx hash欠落を拒否", "23514", () =>
      client.query(
        `INSERT INTO payment_intents
           (id, order_id, payer_wallet_id, payee_wallet_id, chain_id,
            token_address_normalized, from_address_normalized,
            to_address_normalized, amount_atomic, token_decimals, status,
            expires_at)
         VALUES ($1, $2, $3, $4, 80002, $5, $6, $7, 10000, 18,
                 'submitted', CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [
          randomUUID(),
          orderId,
          walletId,
          sellerWalletId,
          tokenAddress,
          walletAddress,
          sellerAddress,
        ],
      ),
    );
    await client.query(
      `INSERT INTO payment_intents
         (id, order_id, payer_wallet_id, payee_wallet_id, chain_id,
          token_address_normalized, from_address_normalized,
          to_address_normalized, amount_atomic, token_decimals, status,
          tx_hash, expires_at, confirmed_at)
       VALUES ($1, $2, $3, $4, 80002, $5, $6, $7, 10000, 18,
               'confirmed', $8, CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP)`,
      [
        randomUUID(),
        orderId,
        walletId,
        sellerWalletId,
        tokenAddress,
        walletAddress,
        sellerAddress,
        txHash,
      ],
    );
    await expectPostgresError("tx hashの再利用を拒否", "23505", () =>
      client.query(
        `INSERT INTO payment_intents
           (id, order_id, payer_wallet_id, payee_wallet_id, chain_id,
            token_address_normalized, from_address_normalized,
            to_address_normalized, amount_atomic, token_decimals, status,
            tx_hash, expires_at)
         VALUES ($1, $2, $3, $4, 80002, $5, $6, $7, 10000, 18,
                 'failed', $8, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [
          randomUUID(),
          orderId,
          walletId,
          sellerWalletId,
          tokenAddress,
          walletAddress,
          sellerAddress,
          txHash,
        ],
      ),
    );

    const auditEventId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO audit_events
         (id, idempotency_key, aggregate_type, aggregate_id, event_type,
          canonical_payload, payload_sha256, occurred_at)
       VALUES ($1, 'order:rollback:test', 'order', $2, 'payment.confirmed',
               '{"status":"paid"}'::jsonb, $3, CURRENT_TIMESTAMP)`,
      [auditEventId, orderId, "b".repeat(64)],
    );
    await client.query(
      `INSERT INTO onchain_outbox
         (audit_event_id, chain_id, contract_address_normalized)
       VALUES ($1, 80002, $2)`,
      [auditEventId, `0x${"4".repeat(40)}`],
    );
    await client.query("ROLLBACK");
    const rolledBackEvent = await client.query(
      "SELECT count(*)::integer AS count FROM audit_events WHERE id = $1",
      [auditEventId],
    );
    assert.equal(
      rolledBackEvent.rows[0].count,
      0,
      "audit eventとoutboxが同じtransactionでrollbackされること",
    );
    console.log("  OK: audit event + outboxのtransaction rollback");

    await client.query(
      `INSERT INTO audit_events
         (id, idempotency_key, aggregate_type, aggregate_id, event_type,
          canonical_payload, payload_sha256, occurred_at)
       VALUES ($1, 'order:paid:test', 'order', $2, 'payment.confirmed',
               '{"status":"paid"}'::jsonb, $3, CURRENT_TIMESTAMP)`,
      [auditEventId, orderId, "c".repeat(64)],
    );
    await client.query(
      `INSERT INTO onchain_outbox
         (audit_event_id, chain_id, contract_address_normalized)
       VALUES ($1, 80002, $2)`,
      [auditEventId, `0x${"4".repeat(40)}`],
    );
    await expectPostgresError("1 eventへのoutbox二重作成を拒否", "23505", () =>
      client.query(
        `INSERT INTO onchain_outbox
           (audit_event_id, chain_id, contract_address_normalized)
         VALUES ($1, 80002, $2)`,
        [auditEventId, `0x${"4".repeat(40)}`],
      ),
    );

    const readyIndex = await client.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'onchain_outbox_ready_idx'`,
      [schema],
    );
    assert.equal(readyIndex.rowCount, 1, "outbox ready検索indexが存在すること");
    console.log("  OK: outbox ready検索indexを確認");

    await client.query(
      `UPDATE schema_migrations
          SET checksum = repeat('0', 64)
        WHERE version = '0001'`,
    );
  } finally {
    await client.end();
  }

  await assert.rejects(
    () =>
      getMigrationStatus({
        connectionString,
        migrationsDirectory,
        schema,
      }),
    /checksum/,
    "適用済みmigrationの改変を検知すること",
  );
  console.log("  OK: migration checksum不一致を検知");
  console.log("Migration統合テストに成功しました");
} finally {
  await cleanupClient.connect();
  try {
    await cleanupClient.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  } finally {
    await cleanupClient.end();
  }
}
