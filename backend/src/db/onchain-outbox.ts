import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { JsonValue } from "../services/canonical-json.js";
import { sha256CanonicalJson } from "../services/canonical-json.js";

export type OnchainOutboxStatus =
  | "pending"
  | "processing"
  | "submitted"
  | "confirmed"
  | "retry"
  | "dead";

export type OnchainOutboxJob = {
  auditEventId: string;
  chainId: number;
  contractAddress: `0x${string}`;
  attemptCount: number;
  txHash: `0x${string}` | null;
  payloadSha256: string;
  occurredAt: Date;
};

export type AuditAnchorRecord = {
  auditEventId: string;
  status: OnchainOutboxStatus;
  chainId: number;
  contractAddress: string;
  payloadSha256: string;
  attemptCount: number;
  txHash: string | null;
  blockNumber: string | null;
  confirmedAt: Date | null;
  lastErrorCode: string | null;
  created: boolean;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super("同じidempotency keyが異なる内容で使用されています。");
    this.name = "IdempotencyConflictError";
  }
}

type CreateAuditAnchorInput = {
  idempotencyKey: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: JsonValue;
  occurredAt: Date;
  chainId: number;
  contractAddress: `0x${string}`;
};

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

function toRecord(row: Record<string, unknown>, created: boolean): AuditAnchorRecord {
  return {
    auditEventId: String(row.audit_event_id),
    status: String(row.status) as OnchainOutboxStatus,
    chainId: Number(row.chain_id),
    contractAddress: String(row.contract_address_normalized),
    payloadSha256: String(row.payload_sha256),
    attemptCount: Number(row.attempt_count),
    txHash: row.tx_hash ? String(row.tx_hash) : null,
    blockNumber: row.block_number ? String(row.block_number) : null,
    confirmedAt: row.confirmed_at ? new Date(String(row.confirmed_at)) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    created,
  };
}

export async function createAuditAnchor(
  pool: Pool,
  input: CreateAuditAnchorInput,
): Promise<AuditAnchorRecord> {
  return withTransaction(pool, (client) =>
    appendAuditAnchorOnClient(client, input),
  );
}

/**
 * 業務transaction内で監査イベントとoutboxを追加するためのclient版。
 * 決済確定・発送・受領確認など、業務状態遷移と同一transactionで呼ぶ
 * (async-onchain-write.md §5)。
 */
export async function appendAuditAnchorOnClient(
  client: PoolClient,
  input: CreateAuditAnchorInput,
): Promise<AuditAnchorRecord> {
  const { canonicalJson, sha256 } = sha256CanonicalJson(input.payload);
  {
    const auditEventId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO audit_events (
         id, idempotency_key, aggregate_type, aggregate_id, event_type,
         event_version, canonical_payload, payload_sha256, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        auditEventId,
        input.idempotencyKey,
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.eventVersion,
        canonicalJson,
        sha256,
        input.occurredAt,
      ],
    );

    const created = inserted.rowCount === 1;
    let effectiveAuditEventId = auditEventId;

    if (!created) {
      const existing = await client.query(
        `SELECT id, aggregate_type, aggregate_id, event_type, event_version,
                payload_sha256, occurred_at
           FROM audit_events
          WHERE idempotency_key = $1
          FOR UPDATE`,
        [input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (
        !row ||
        row.aggregate_type !== input.aggregateType ||
        row.aggregate_id !== input.aggregateId ||
        row.event_type !== input.eventType ||
        Number(row.event_version) !== input.eventVersion ||
        row.payload_sha256 !== sha256 ||
        new Date(row.occurred_at).getTime() !== input.occurredAt.getTime()
      ) {
        throw new IdempotencyConflictError();
      }
      effectiveAuditEventId = row.id;
    }

    await client.query(
      `INSERT INTO onchain_outbox (
         audit_event_id, chain_id, contract_address_normalized
       ) VALUES ($1, $2, $3)
       ON CONFLICT (audit_event_id) DO NOTHING`,
      [effectiveAuditEventId, input.chainId, input.contractAddress],
    );

    const result = await client.query(
      `SELECT o.*, a.payload_sha256
         FROM onchain_outbox o
         JOIN audit_events a ON a.id = o.audit_event_id
        WHERE o.audit_event_id = $1`,
      [effectiveAuditEventId],
    );
    const row = result.rows[0];
    if (
      !row ||
      Number(row.chain_id) !== input.chainId ||
      row.contract_address_normalized !== input.contractAddress
    ) {
      throw new IdempotencyConflictError();
    }
    return toRecord(row, created);
  }
}

export async function getAuditAnchor(
  pool: Pool,
  auditEventId: string,
): Promise<AuditAnchorRecord | null> {
  const result = await pool.query(
    `SELECT o.*, a.payload_sha256
       FROM onchain_outbox o
       JOIN audit_events a ON a.id = o.audit_event_id
      WHERE o.audit_event_id = $1`,
    [auditEventId],
  );
  return result.rows[0] ? toRecord(result.rows[0], false) : null;
}

export async function claimOnchainJobs(
  pool: Pool,
  input: {
    workerId: string;
    batchSize: number;
    lockTimeoutSeconds: number;
  },
): Promise<OnchainOutboxJob[]> {
  const result = await pool.query(
    `WITH candidates AS MATERIALIZED (
       SELECT audit_event_id
         FROM onchain_outbox
        WHERE (
          status IN ('pending', 'retry', 'submitted')
          AND next_attempt_at <= CURRENT_TIMESTAMP
        ) OR (
          status = 'processing'
          AND locked_at < CURRENT_TIMESTAMP - make_interval(secs => $3::double precision)
        )
        ORDER BY next_attempt_at, created_at, audit_event_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     ), claimed AS (
       UPDATE onchain_outbox o
          SET status = 'processing',
              attempt_count = attempt_count + 1,
              locked_at = CURRENT_TIMESTAMP,
              locked_by = $1,
              last_error_code = NULL,
              last_error_message = NULL
         FROM candidates c
        WHERE o.audit_event_id = c.audit_event_id
       RETURNING o.*
     )
     SELECT c.*, a.payload_sha256, a.occurred_at
       FROM claimed c
       JOIN audit_events a ON a.id = c.audit_event_id
      ORDER BY c.created_at, c.audit_event_id`,
    [input.workerId, input.batchSize, input.lockTimeoutSeconds],
  );

  return result.rows.map((row) => ({
    auditEventId: row.audit_event_id,
    chainId: Number(row.chain_id),
    contractAddress: row.contract_address_normalized,
    attemptCount: Number(row.attempt_count),
    txHash: row.tx_hash,
    payloadSha256: row.payload_sha256,
    occurredAt: new Date(row.occurred_at),
  }));
}

export async function saveSubmittedTransaction(
  pool: Pool,
  input: { auditEventId: string; workerId: string; txHash: string },
): Promise<void> {
  const result = await pool.query(
    `UPDATE onchain_outbox
        SET tx_hash = $3,
            submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP)
      WHERE audit_event_id = $1
        AND status = 'processing'
        AND locked_by = $2`,
    [input.auditEventId, input.workerId, input.txHash.toLowerCase()],
  );
  if (result.rowCount !== 1) throw new Error("outboxジョブのロックを失いました。");
}

export async function markOnchainConfirmed(
  pool: Pool,
  input: {
    auditEventId: string;
    workerId: string;
    txHash: string;
    blockNumber: bigint;
  },
): Promise<void> {
  const result = await pool.query(
    `UPDATE onchain_outbox
        SET status = 'confirmed',
            tx_hash = $3,
            block_number = $4,
            submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
            confirmed_at = CURRENT_TIMESTAMP,
            locked_at = NULL,
            locked_by = NULL,
            last_error_code = NULL,
            last_error_message = NULL
      WHERE audit_event_id = $1
        AND status = 'processing'
        AND locked_by = $2`,
    [
      input.auditEventId,
      input.workerId,
      input.txHash.toLowerCase(),
      input.blockNumber.toString(),
    ],
  );
  if (result.rowCount !== 1) throw new Error("outboxジョブのロックを失いました。");
}

export async function markOnchainFailure(
  pool: Pool,
  input: {
    auditEventId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    attemptCount: number;
    maxAttempts: number;
    txHash: string | null;
    retryDelayMs: number;
  },
): Promise<OnchainOutboxStatus> {
  const terminal = !input.retryable || input.attemptCount >= input.maxAttempts;
  const nextStatus: OnchainOutboxStatus = terminal
    ? "dead"
    : input.txHash
      ? "submitted"
      : "retry";
  const result = await pool.query(
    `UPDATE onchain_outbox
        SET status = $3,
            tx_hash = COALESCE($4, tx_hash),
            next_attempt_at = CURRENT_TIMESTAMP + ($5::double precision * interval '1 millisecond'),
            locked_at = NULL,
            locked_by = NULL,
            last_error_code = $6,
            last_error_message = $7
      WHERE audit_event_id = $1
        AND status = 'processing'
        AND locked_by = $2`,
    [
      input.auditEventId,
      input.workerId,
      nextStatus,
      input.txHash?.toLowerCase() ?? null,
      input.retryDelayMs,
      input.errorCode.slice(0, 64),
      input.errorMessage.slice(0, 1_000),
    ],
  );
  if (result.rowCount !== 1) throw new Error("outboxジョブのロックを失いました。");
  return nextStatus;
}
