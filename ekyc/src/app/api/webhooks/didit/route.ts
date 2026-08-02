import { NextRequest, NextResponse } from "next/server";
import { getSessionDecision } from "@/lib/didit/client";
import {
  getVerificationBySessionId,
  insertWebhookLog,
  updateVerification,
} from "@/lib/db";
import {
  extractChecks,
  mapDiditStatus,
  normalizeDecision,
} from "@/lib/didit/normalize";
import { verifyWebhookSignature } from "@/lib/didit/signature";
import { getWebhookSecret } from "@/lib/env";

/**
 * POST /api/webhooks/didit
 *
 * Signed webhook receiver. This — not the browser redirect — is the source
 * of truth for verification results when a public URL is available.
 * Signature is verified as V2 → Simple → raw, per Didit's documentation.
 */
export async function POST(request: NextRequest) {
  const secret = getWebhookSecret();
  if (!secret) {
    console.error("DIDIT_WEBHOOK_SECRET_KEY is not configured");
    return NextResponse.json(
      { success: false, error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const rawBody = await request.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const result = verifyWebhookSignature({
    rawBody,
    headers: {
      "x-signature": request.headers.get("x-signature"),
      "x-signature-v2": request.headers.get("x-signature-v2"),
      "x-signature-simple": request.headers.get("x-signature-simple"),
    },
    secret,
  });

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const diditStatus = typeof body.status === "string" ? body.status : "";

  try {
    insertWebhookLog({
      sessionId: sessionId || "unknown",
      status: diditStatus || "unknown",
      signatureMethod: result.method,
      isSignatureValid: result.isValid,
      rawPayload: rawBody,
    });
  } catch (error) {
    console.error("Failed to log webhook:", error);
  }

  if (!result.isValid) {
    console.error("Webhook signature verification failed");
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 },
    );
  }

  if (!sessionId) {
    return NextResponse.json(
      { success: false, error: "Missing session_id" },
      { status: 400 },
    );
  }

  const known = getVerificationBySessionId(sessionId);
  if (!known) {
    // Acknowledge with 200 so Didit does not retry a session we never created.
    console.warn(`Webhook for unknown session: ${sessionId}`);
    return NextResponse.json({ success: true, acknowledged: true });
  }

  const status = mapDiditStatus(diditStatus);

  // Webhook payloads may embed the decision; otherwise fetch the full
  // report so per-feature checks are stored alongside the status.
  let checks = known.checks;
  const embeddedDecision = body.decision;
  if (embeddedDecision && typeof embeddedDecision === "object") {
    checks = extractChecks(embeddedDecision as Record<string, unknown>);
  } else if (["approved", "declined", "in_review"].includes(status)) {
    try {
      const decision = await getSessionDecision(sessionId);
      checks = normalizeDecision(decision).checks;
    } catch (error) {
      console.error("Decision fetch after webhook failed:", error);
    }
  }

  updateVerification({ sessionId, status, checks, source: "webhook" });

  return NextResponse.json({ success: true });
}
