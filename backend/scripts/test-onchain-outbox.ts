import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import {
  claimOnchainJobs,
  createAuditAnchor,
  getAuditAnchor,
  IdempotencyConflictError,
  markOnchainConfirmed,
  saveSubmittedTransaction,
} from "../src/db/onchain-outbox.js";
import { quoteIdentifier, runMigrations } from "./lib/migrator.mjs";

const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URLまたはDATABASE_URLを指定してoutbox統合テストを実行してください。",
  );
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(
  currentDirectory,
  "../src/db/migrations",
);
const schema = `trustca_onchain_test_${process.pid}_${Date.now()}`;
if (!schema.startsWith("trustca_onchain_test_")) {
  throw new Error(`安全でない一時schema名です: ${schema}`);
}

const quotedSchema = quoteIdentifier(schema);
const cleanupClient = new Client({ connectionString });
let pool: Pool | undefined;

try {
  console.log(`一時schema ${schema} でoutboxを検証します`);
  await runMigrations({ connectionString, migrationsDirectory, schema });
  pool = new Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
  });

  const occurredAt = new Date("2026-08-13T00:00:00.000Z");
  const baseInput = {
    idempotencyKey: `order.completed:${randomUUID()}`,
    aggregateType: "order",
    aggregateId: randomUUID(),
    eventType: "order.completed",
    eventVersion: 1,
    payload: { amount: "12000", currency: "JPYC", orderState: "paid" },
    occurredAt,
    chainId: 31_337,
    contractAddress: `0x${"1".repeat(40)}` as const,
  };

  const created = await createAuditAnchor(pool, baseInput);
  assert.equal(created.created, true);
  assert.equal(created.status, "pending");
  console.log("  OK: audit eventとoutboxを同一transactionで登録");

  const duplicate = await createAuditAnchor(pool, baseInput);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.auditEventId, created.auditEventId);
  await assert.rejects(
    createAuditAnchor(pool, {
      ...baseInput,
      payload: { amount: "99999", currency: "JPYC", orderState: "paid" },
    }),
    IdempotencyConflictError,
  );
  console.log("  OK: 同一入力は冪等、異なる入力は409相当の競合");

  const [workerA, workerB] = await Promise.all([
    claimOnchainJobs(pool, {
      workerId: "integration-worker-a",
      batchSize: 1,
      lockTimeoutSeconds: 120,
    }),
    claimOnchainJobs(pool, {
      workerId: "integration-worker-b",
      batchSize: 1,
      lockTimeoutSeconds: 120,
    }),
  ]);
  const claimed = [...workerA, ...workerB];
  assert.equal(claimed.length, 1, "同じjobは1 workerだけがclaimすること");
  assert.equal(claimed[0]?.auditEventId, created.auditEventId);
  console.log("  OK: FOR UPDATE SKIP LOCKEDで二重claimを防止");

  const workerId = workerA.length > 0
    ? "integration-worker-a"
    : "integration-worker-b";
  const txHash = `0x${"2".repeat(64)}`;
  await saveSubmittedTransaction(pool, {
    auditEventId: created.auditEventId,
    workerId,
    txHash,
  });
  await markOnchainConfirmed(pool, {
    auditEventId: created.auditEventId,
    workerId,
    txHash,
    blockNumber: 123n,
  });
  const confirmed = await getAuditAnchor(pool, created.auditEventId);
  assert.equal(confirmed?.status, "confirmed");
  assert.equal(confirmed?.txHash, txHash);
  assert.equal(confirmed?.blockNumber, "123");
  assert.ok(confirmed?.confirmedAt);
  console.log("  OK: tx送信済み状態とblock確定情報を永続化");

  console.log("outbox統合テストに成功しました。");
} finally {
  await pool?.end();
  await cleanupClient.connect();
  try {
    await cleanupClient.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  } finally {
    await cleanupClient.end();
  }
}
