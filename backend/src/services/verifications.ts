import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { insertNotification } from "../db/notifications.js";
import {
  applyProviderDecision,
  createSession,
  DuplicateActiveVerificationError,
  getActiveForSeller,
  getBySessionId,
  getEventsForVerification,
  getLatestForSeller,
  listInReview as listInReviewFromDb,
  recordOperatorDecision,
  recordWebhookEvent,
  VerificationConflictError,
  type Verification,
  type VerificationEvent,
} from "../db/verifications.js";
import type { DiditConfig } from "../env.js";
import {
  createVerificationSession,
  DiditApiError,
  getSessionDecision,
} from "./didit/client.js";
import {
  extractChecks,
  isSellingAllowed,
  mapDiditStatus,
  normalizeDecision,
  type KycChecks,
} from "./didit/normalize.js";
import { verifyWebhookSignature } from "./didit/signature.js";

export { DuplicateActiveVerificationError, VerificationConflictError };

const REFRESHABLE_STATUSES = new Set(["not_started", "in_progress", "in_review"]);
const DECISION_REQUIRED_STATUSES = new Set(["approved", "declined", "in_review"]);

export type VerificationStatusView = {
  verification: Verification | null;
  isSellingAllowed: boolean;
  events: VerificationEvent[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Starts (or idempotently reuses) a verification session for a seller.
 * A seller can only have one non-terminal session at a time; if one already
 * exists we return it instead of calling Didit again.
 */
export async function startVerificationSession(
  pool: Pool,
  config: DiditConfig,
  input: { sellerId: string; callbackUrl: string },
): Promise<Verification> {
  const active = await getActiveForSeller(pool, input.sellerId);
  if (active) return active;

  const created = await createVerificationSession(config, {
    vendorData: input.sellerId,
    callbackUrl: input.callbackUrl,
  });

  try {
    return await createSession(pool, {
      sellerId: input.sellerId,
      providerSessionId: created.sessionId,
      sessionUrl: created.sessionUrl,
    });
  } catch (error) {
    if (error instanceof DuplicateActiveVerificationError) {
      const existing = await getActiveForSeller(pool, input.sellerId);
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * Returns the seller's current verification state, optionally refreshing it
 * from Didit's decision API first (the polling fallback for local dev where
 * webhooks cannot reach localhost).
 */
export async function getVerificationStatus(
  pool: Pool,
  config: DiditConfig,
  sellerId: string,
  options: { refresh: boolean },
): Promise<VerificationStatusView> {
  let latest = await getLatestForSeller(pool, sellerId);

  if (latest && options.refresh && REFRESHABLE_STATUSES.has(latest.status)) {
    try {
      const decision = await getSessionDecision(config, latest.providerSessionId);
      const normalized = normalizeDecision(decision);
      await applyProviderDecision(pool, {
        providerSessionId: latest.providerSessionId,
        status: normalized.status,
        providerStatus:
          typeof decision.status === "string" ? decision.status : null,
        checks: normalized.checks,
        source: "poll",
      });
      latest = await getLatestForSeller(pool, sellerId);
    } catch (error) {
      console.error("Didit decision refresh failed:", error);
      // Fall through: serve the last known local state rather than failing.
    }
  }

  return {
    verification: latest,
    isSellingAllowed: latest ? isSellingAllowed(latest.status) : false,
    events: latest ? await getEventsForVerification(pool, latest.id) : [],
  };
}

export type WebhookApplyResult =
  | { outcome: "invalid_signature" }
  | { outcome: "duplicate" }
  | { outcome: "unknown_session" }
  | { outcome: "applied" };

/**
 * Verifies and applies a Didit webhook. Every receipt is logged (even
 * invalid or unknown ones) for audit purposes before any decision is made;
 * only a valid, non-duplicate signature can change verification state.
 */
export async function applyWebhook(
  pool: Pool,
  config: DiditConfig,
  input: { rawBody: string; headers: Record<string, string | undefined> },
): Promise<WebhookApplyResult> {
  const verification = verifyWebhookSignature({
    rawBody: input.rawBody,
    headers: {
      "x-signature": input.headers["x-signature"] ?? null,
      "x-signature-v2": input.headers["x-signature-v2"] ?? null,
      "x-signature-simple": input.headers["x-signature-simple"] ?? null,
    },
    secret: config.webhookSecret,
  });

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const sessionId = typeof body.session_id === "string" ? body.session_id : null;
  const diditStatus = typeof body.status === "string" ? body.status : null;

  const logged = await recordWebhookEvent(pool, {
    provider: "didit",
    providerEventId: sessionId && diditStatus ? `${sessionId}:${diditStatus}:${String(body.created_at ?? "")}` : null,
    eventType: typeof body.webhook_type === "string" ? body.webhook_type : null,
    providerStatus: diditStatus,
    payloadSha256: sha256(input.rawBody),
    signatureMethod: verification.method,
    signatureValid: verification.isValid,
  });

  if (!verification.isValid) return { outcome: "invalid_signature" };
  if (logged.isDuplicate) return { outcome: "duplicate" };
  if (!sessionId) return { outcome: "unknown_session" };

  const known = await getBySessionId(pool, sessionId);
  if (!known) return { outcome: "unknown_session" };

  const status = mapDiditStatus(diditStatus ?? "");

  let checks: KycChecks | null = known.checks;
  const embeddedDecision = body.decision;
  if (isRecord(embeddedDecision)) {
    checks = extractChecks(embeddedDecision);
  } else if (DECISION_REQUIRED_STATUSES.has(status)) {
    try {
      const decision = await getSessionDecision(config, sessionId);
      checks = normalizeDecision(decision).checks;
    } catch (error) {
      console.error("Decision fetch after webhook failed:", error);
    }
  }

  await applyProviderDecision(pool, {
    providerSessionId: sessionId,
    status,
    providerStatus: diditStatus,
    checks,
    source: "webhook",
  });

  return { outcome: "applied" };
}

export async function listInReview(pool: Pool): Promise<
  Array<{ verification: Verification; events: VerificationEvent[] }>
> {
  const verifications = await listInReviewFromDb(pool);
  return Promise.all(
    verifications.map(async (verification) => ({
      verification,
      events: await getEventsForVerification(pool, verification.id),
    })),
  );
}

export async function decideAsOperator(
  pool: Pool,
  input: {
    verificationId: string;
    decision: "approved" | "declined";
    reason: string;
    actorUserId: string | null;
  },
): Promise<Verification> {
  const verification = await recordOperatorDecision(pool, input);
  // 通知は補助機能のため、失敗しても審査結果を巻き戻さない
  await insertNotification(pool, {
    userId: verification.sellerId,
    type: "kyc_decided",
    title:
      input.decision === "approved"
        ? "本人確認が承認されました"
        : "本人確認が承認されませんでした",
    body:
      input.decision === "approved"
        ? "出品が可能になりました。"
        : "再度お手続きいただくか、運営までお問い合わせください。",
  }).catch(() => undefined);
  return verification;
}

export { DiditApiError };
