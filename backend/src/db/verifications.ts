import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { KycChecks, KycStatus } from "../services/didit/normalize.js";

export type VerificationSource = "created" | "webhook" | "poll" | "operator";

export type Verification = {
  id: string;
  sellerId: string;
  provider: string;
  providerSessionId: string;
  status: KycStatus;
  providerStatus: string | null;
  checks: KycChecks | null;
  sessionUrl: string | null;
  source: VerificationSource;
  requestedAt: Date;
  decidedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VerificationEventType =
  | "session_created"
  | "status_changed"
  | "checks_updated"
  | "operator_decision";

export type VerificationEvent = {
  id: string;
  verificationId: string;
  eventType: VerificationEventType;
  fromStatus: KycStatus | null;
  toStatus: KycStatus;
  checks: KycChecks | null;
  source: VerificationSource;
  actorUserId: string | null;
  reason: string | null;
  createdAt: Date;
};

const ACTIVE_STATUSES: KycStatus[] = ["not_started", "in_progress", "in_review"];
const TERMINAL_STATUSES: KycStatus[] = ["approved", "declined"];
const ONBOARDING_SYNCED_STATUSES: KycStatus[] = [
  "in_review",
  "approved",
  "declined",
];

export class DuplicateActiveVerificationError extends Error {
  constructor() {
    super("既に進行中の本人確認セッションがあります。");
    this.name = "DuplicateActiveVerificationError";
  }
}

export class VerificationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationConflictError";
  }
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  return value ? toDate(value) : null;
}

function toVerification(row: Record<string, unknown>): Verification {
  return {
    id: String(row.id),
    sellerId: String(row.seller_id),
    provider: String(row.provider),
    providerSessionId: String(row.provider_session_id),
    status: row.status as KycStatus,
    providerStatus: row.provider_status ? String(row.provider_status) : null,
    checks: (row.checks as KycChecks | null) ?? null,
    sessionUrl: row.session_url ? String(row.session_url) : null,
    source: row.source as VerificationSource,
    requestedAt: toDate(row.requested_at),
    decidedAt: toNullableDate(row.decided_at),
    expiresAt: toNullableDate(row.expires_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toEvent(row: Record<string, unknown>): VerificationEvent {
  return {
    id: String(row.id),
    verificationId: String(row.verification_id),
    eventType: row.event_type as VerificationEventType,
    fromStatus: (row.from_status as KycStatus | null) ?? null,
    toStatus: row.to_status as KycStatus,
    checks: (row.checks as KycChecks | null) ?? null,
    source: row.source as VerificationSource,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    reason: row.reason ? String(row.reason) : null,
    createdAt: toDate(row.created_at),
  };
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

function checksEqual(a: KycChecks | null, b: KycChecks | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toJsonbParam(value: KycChecks | null): string | null {
  return value ? JSON.stringify(value) : null;
}

async function syncSellerOnboardingStatus(
  client: PoolClient,
  sellerId: string,
  status: KycStatus,
): Promise<void> {
  if (!ONBOARDING_SYNCED_STATUSES.includes(status)) return;
  if (status === "approved") {
    await client.query(
      `UPDATE seller_profiles
          SET onboarding_status = 'approved', approved_at = CURRENT_TIMESTAMP
        WHERE user_id = $1`,
      [sellerId],
    );
    return;
  }
  // in_review/declined: never downgrade a profile that a later approval already confirmed.
  await client.query(
    `UPDATE seller_profiles
        SET onboarding_status = $2
      WHERE user_id = $1 AND onboarding_status <> 'approved'`,
    [sellerId, status],
  );
}

export async function getActiveForSeller(
  pool: Pool,
  sellerId: string,
): Promise<Verification | null> {
  const result = await pool.query(
    `SELECT * FROM seller_verifications
      WHERE seller_id = $1 AND status = ANY($2::varchar[])
      ORDER BY created_at DESC
      LIMIT 1`,
    [sellerId, ACTIVE_STATUSES],
  );
  return result.rows[0] ? toVerification(result.rows[0]) : null;
}

export async function getLatestForSeller(
  pool: Pool,
  sellerId: string,
): Promise<Verification | null> {
  const result = await pool.query(
    `SELECT * FROM seller_verifications
      WHERE seller_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [sellerId],
  );
  return result.rows[0] ? toVerification(result.rows[0]) : null;
}

export async function getBySessionId(
  pool: Pool,
  providerSessionId: string,
  provider = "didit",
): Promise<Verification | null> {
  const result = await pool.query(
    `SELECT * FROM seller_verifications
      WHERE provider = $1 AND provider_session_id = $2`,
    [provider, providerSessionId],
  );
  return result.rows[0] ? toVerification(result.rows[0]) : null;
}

export async function listInReview(pool: Pool): Promise<Verification[]> {
  const result = await pool.query(
    `SELECT * FROM seller_verifications
      WHERE status = 'in_review'
      ORDER BY created_at ASC`,
  );
  return result.rows.map(toVerification);
}

export async function getEventsForVerification(
  pool: Pool,
  verificationId: string,
): Promise<VerificationEvent[]> {
  const result = await pool.query(
    `SELECT * FROM verification_events
      WHERE verification_id = $1
      ORDER BY id ASC`,
    [verificationId],
  );
  return result.rows.map(toEvent);
}

/**
 * Starts a new verification session for a seller. Advisory-locked on the
 * seller ID so two concurrent requests cannot both pass the "no active
 * session" check and create duplicates (seller_verifications also enforces
 * this with a partial unique index as a second line of defense).
 */
export async function createSession(
  pool: Pool,
  input: { sellerId: string; providerSessionId: string; sessionUrl: string },
): Promise<Verification> {
  return withTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`seller-verification:${input.sellerId}`],
    );
    const existingActive = await client.query(
      `SELECT id FROM seller_verifications
        WHERE seller_id = $1 AND status = ANY($2::varchar[])
        LIMIT 1`,
      [input.sellerId, ACTIVE_STATUSES],
    );
    if (existingActive.rows[0]) {
      throw new DuplicateActiveVerificationError();
    }

    const id = randomUUID();
    const inserted = await client.query(
      `INSERT INTO seller_verifications (
         id, seller_id, provider, provider_session_id, status, source, session_url
       ) VALUES ($1, $2, 'didit', $3, 'not_started', 'created', $4)
       RETURNING *`,
      [id, input.sellerId, input.providerSessionId, input.sessionUrl],
    );
    await client.query(
      `INSERT INTO verification_events (
         verification_id, event_type, from_status, to_status, source
       ) VALUES ($1, 'session_created', NULL, 'not_started', 'created')`,
      [id],
    );
    return toVerification(inserted.rows[0]);
  });
}

/**
 * Applies a status/checks update coming from Didit (webhook or poll). A
 * verification already in a terminal state (approved/declined) is never
 * overwritten by a later, out-of-order provider report.
 */
export async function applyProviderDecision(
  pool: Pool,
  input: {
    providerSessionId: string;
    status: KycStatus;
    providerStatus: string | null;
    checks: KycChecks | null;
    source: Extract<VerificationSource, "webhook" | "poll">;
  },
): Promise<Verification | null> {
  return withTransaction(pool, async (client) => {
    const current = await client.query(
      `SELECT * FROM seller_verifications
        WHERE provider = 'didit' AND provider_session_id = $1
        FOR UPDATE`,
      [input.providerSessionId],
    );
    if (!current.rows[0]) return null;
    const existing = toVerification(current.rows[0]);

    if (TERMINAL_STATUSES.includes(existing.status)) {
      return existing;
    }

    const statusChanged = existing.status !== input.status;
    const checksChanged = !checksEqual(existing.checks, input.checks);
    if (!statusChanged && !checksChanged) {
      return existing;
    }

    const becomesTerminal = TERMINAL_STATUSES.includes(input.status);
    const updated = await client.query(
      `UPDATE seller_verifications
          SET status = $2,
              provider_status = $3,
              checks = $4::jsonb,
              source = $5,
              decided_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE decided_at END
        WHERE id = $1
      RETURNING *`,
      [
        existing.id,
        input.status,
        input.providerStatus,
        toJsonbParam(input.checks),
        input.source,
        becomesTerminal,
      ],
    );

    await client.query(
      `INSERT INTO verification_events (
         verification_id, event_type, from_status, to_status, checks, source
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        existing.id,
        statusChanged ? "status_changed" : "checks_updated",
        existing.status,
        input.status,
        toJsonbParam(input.checks),
        input.source,
      ],
    );

    if (statusChanged) {
      await syncSellerOnboardingStatus(client, existing.sellerId, input.status);
    }

    return toVerification(updated.rows[0]);
  });
}

/**
 * Applies an operator's approve/decline decision. Only a verification
 * currently in_review can be decided this way — already-terminal Didit
 * decisions are out of scope (seller-onboarding-review-flow.md §5.1).
 */
export async function recordOperatorDecision(
  pool: Pool,
  input: {
    verificationId: string;
    decision: Extract<KycStatus, "approved" | "declined">;
    reason: string;
    actorUserId: string | null;
  },
): Promise<Verification> {
  return withTransaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE seller_verifications
          SET status = $2,
              source = 'operator',
              decided_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'in_review'
      RETURNING *`,
      [input.verificationId, input.decision],
    );
    if (!updated.rows[0]) {
      throw new VerificationConflictError(
        "対象は審査中(in_review)ではないため、確定できません。",
      );
    }
    const verification = toVerification(updated.rows[0]);

    await client.query(
      `INSERT INTO verification_events (
         verification_id, event_type, from_status, to_status, checks, source, actor_user_id, reason
       ) VALUES ($1, 'operator_decision', 'in_review', $2, $3::jsonb, 'operator', $4, $5)`,
      [
        input.verificationId,
        input.decision,
        toJsonbParam(verification.checks),
        input.actorUserId,
        input.reason,
      ],
    );

    await syncSellerOnboardingStatus(client, verification.sellerId, input.decision);

    return verification;
  });
}

/**
 * Records receipt of a webhook for audit/dedup purposes. Returns
 * isDuplicate=true instead of throwing when the same event/payload was
 * already recorded (provider_event_id or payload_sha256 unique index).
 */
export async function recordWebhookEvent(
  pool: Pool,
  input: {
    provider: string;
    providerEventId: string | null;
    eventType: string | null;
    providerStatus: string | null;
    payloadSha256: string;
    signatureMethod: "v2" | "simple" | "raw" | null;
    signatureValid: boolean;
  },
): Promise<{ id: string; isDuplicate: boolean }> {
  try {
    const result = await pool.query(
      `INSERT INTO webhook_events (
         id, provider, provider_event_id, event_type, provider_status,
         payload_sha256, signature_method, signature_valid, processed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END)
       RETURNING id`,
      [
        randomUUID(),
        input.provider,
        input.providerEventId,
        input.eventType,
        input.providerStatus,
        input.payloadSha256,
        input.signatureMethod,
        input.signatureValid,
      ],
    );
    return { id: String(result.rows[0].id), isDuplicate: false };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return { id: "", isDuplicate: true };
    }
    throw error;
  }
}
