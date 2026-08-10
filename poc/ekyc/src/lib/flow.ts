import type { CheckResult, KycChecks, KycStatus } from "@/lib/didit/normalize";

export type FlowStepKey =
  | "register"
  | "session"
  | "document"
  | "liveness"
  | "face_match"
  | "decision";

export type FlowStepState = "done" | "active" | "review" | "failed" | "waiting";

export type FlowStep = {
  key: FlowStepKey;
  label: string;
  state: FlowStepState;
};

type VerificationSnapshot = {
  status: KycStatus;
  checks: KycChecks | null;
};

const CHECK_STEP_ORDER: Array<{
  key: Extract<FlowStepKey, "document" | "liveness" | "face_match">;
  checkKey: keyof KycChecks;
  label: string;
}> = [
  { key: "document", checkKey: "document", label: "本人確認書類" },
  { key: "liveness", checkKey: "liveness", label: "ライブネス" },
  { key: "face_match", checkKey: "faceMatch", label: "顔照合" },
];

const CHECK_STATE_MAP: Record<CheckResult, FlowStepState> = {
  passed: "done",
  failed: "failed",
  in_review: "review",
  not_run: "waiting",
};

function decisionState(status: KycStatus): FlowStepState {
  switch (status) {
    case "approved":
      return "done";
    case "declined":
    case "expired":
    case "abandoned":
      return "failed";
    case "in_review":
      return "review";
    default:
      return "waiting";
  }
}

/**
 * Derive the display state of each stage in the seller verification flow.
 * Registration is always done by the time this renders; the session step
 * completes once a Didit session exists. While the user is still going
 * through the hosted flow, the first unfinished check is shown as active.
 */
export function deriveFlowSteps(
  verification: VerificationSnapshot | null,
): FlowStep[] {
  const steps: FlowStep[] = [{ key: "register", label: "販売者登録", state: "done" }];

  if (!verification) {
    steps.push({ key: "session", label: "KYCセッション作成", state: "active" });
    for (const check of CHECK_STEP_ORDER) {
      steps.push({ key: check.key, label: check.label, state: "waiting" });
    }
    steps.push({ key: "decision", label: "最終判定", state: "waiting" });
    return steps;
  }

  steps.push({ key: "session", label: "KYCセッション作成", state: "done" });

  const isUserStillVerifying = ["not_started", "in_progress"].includes(
    verification.status,
  );
  let hasMarkedActive = false;

  for (const check of CHECK_STEP_ORDER) {
    const result = verification.checks?.[check.checkKey] ?? "not_run";
    let state = CHECK_STATE_MAP[result];
    if (
      state === "waiting" &&
      isUserStillVerifying &&
      !hasMarkedActive
    ) {
      state = "active";
      hasMarkedActive = true;
    }
    steps.push({ key: check.key, label: check.label, state });
  }

  steps.push({
    key: "decision",
    label: "最終判定",
    state: decisionState(verification.status),
  });

  return steps;
}
