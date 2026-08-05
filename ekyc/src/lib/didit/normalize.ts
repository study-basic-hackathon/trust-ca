export type KycStatus =
  | "not_started"
  | "in_progress"
  | "in_review"
  | "approved"
  | "declined"
  | "abandoned"
  | "expired";

export type CheckResult = "passed" | "failed" | "in_review" | "not_run";

export type KycChecks = {
  document: CheckResult;
  liveness: CheckResult;
  faceMatch: CheckResult;
  ipAnalysis: CheckResult;
};

export type NormalizedDecision = {
  sessionId: string;
  status: KycStatus;
  vendorData: string | null;
  checks: KycChecks;
};

const DIDIT_STATUS_MAP: Record<string, KycStatus> = {
  "Not Started": "not_started",
  "In Progress": "in_progress",
  "Awaiting User": "in_progress",
  Resubmitted: "in_progress",
  "In Review": "in_review",
  Approved: "approved",
  Declined: "declined",
  Abandoned: "abandoned",
  Expired: "expired",
  "Kyc Expired": "expired",
};

/**
 * Unknown statuses intentionally fall back to in_review: a status we do not
 * recognize must never grant selling permission automatically.
 */
export function mapDiditStatus(diditStatus: string): KycStatus {
  return DIDIT_STATUS_MAP[diditStatus] ?? "in_review";
}

const FEATURE_STATUS_MAP: Record<string, CheckResult> = {
  Approved: "passed",
  Declined: "failed",
};

type FeatureItem = { status?: unknown };

function latestFeatureResult(items: unknown): CheckResult {
  if (!Array.isArray(items) || items.length === 0) {
    return "not_run";
  }
  const latest = items[items.length - 1] as FeatureItem;
  const status = typeof latest.status === "string" ? latest.status : "";
  return FEATURE_STATUS_MAP[status] ?? "in_review";
}

/**
 * Extract per-feature results from a Didit decision report. Feature blocks
 * are arrays (a workflow can run a feature more than once); the latest
 * entry wins. A null/absent block means the feature never ran.
 */
export function extractChecks(decision: Record<string, unknown>): KycChecks {
  return {
    document: latestFeatureResult(decision.id_verifications),
    liveness: latestFeatureResult(decision.liveness_checks),
    faceMatch: latestFeatureResult(decision.face_matches),
    ipAnalysis: latestFeatureResult(decision.ip_analyses),
  };
}

export function isSellingAllowed(status: KycStatus): boolean {
  return status === "approved";
}

export function normalizeDecision(
  decision: Record<string, unknown>,
): NormalizedDecision {
  const sessionId = decision.session_id;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("Didit decision payload is missing session_id");
  }

  return {
    sessionId,
    status: mapDiditStatus(String(decision.status ?? "")),
    vendorData:
      typeof decision.vendor_data === "string" ? decision.vendor_data : null,
    checks: extractChecks(decision),
  };
}
