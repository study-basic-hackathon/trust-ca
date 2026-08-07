import { describe, expect, test } from "vitest";
import { deriveFlowSteps } from "@/lib/flow";
import type { KycChecks, KycStatus } from "@/lib/didit/normalize";

function verification(status: KycStatus, checks: Partial<KycChecks> | null) {
  return {
    status,
    checks: checks
      ? {
          document: "not_run",
          liveness: "not_run",
          faceMatch: "not_run",
          ipAnalysis: "not_run",
          ...checks,
        }
      : null,
  } as { status: KycStatus; checks: KycChecks | null };
}

function statesOf(steps: ReturnType<typeof deriveFlowSteps>) {
  return Object.fromEntries(steps.map((s) => [s.key, s.state]));
}

describe("deriveFlowSteps", () => {
  test("no verification yet: only registration is done, session is active", () => {
    const steps = deriveFlowSteps(null);
    expect(statesOf(steps)).toEqual({
      register: "done",
      session: "active",
      document: "waiting",
      liveness: "waiting",
      face_match: "waiting",
      decision: "waiting",
    });
  });

  test("session created but not started: checks waiting, decision waiting", () => {
    const steps = deriveFlowSteps(verification("not_started", null));
    expect(statesOf(steps)).toEqual({
      register: "done",
      session: "done",
      document: "active",
      liveness: "waiting",
      face_match: "waiting",
      decision: "waiting",
    });
  });

  test("in progress with document passed: next unfinished check is active", () => {
    const steps = deriveFlowSteps(
      verification("in_progress", { document: "passed" }),
    );
    expect(statesOf(steps)).toEqual({
      register: "done",
      session: "done",
      document: "done",
      liveness: "active",
      face_match: "waiting",
      decision: "waiting",
    });
  });

  test("approved: everything done", () => {
    const steps = deriveFlowSteps(
      verification("approved", {
        document: "passed",
        liveness: "passed",
        faceMatch: "passed",
      }),
    );
    expect(statesOf(steps)).toEqual({
      register: "done",
      session: "done",
      document: "done",
      liveness: "done",
      face_match: "done",
      decision: "done",
    });
  });

  test("declined with a failed check: check and decision are failed", () => {
    const steps = deriveFlowSteps(
      verification("declined", {
        document: "passed",
        liveness: "passed",
        faceMatch: "failed",
      }),
    );
    expect(statesOf(steps)).toEqual({
      register: "done",
      session: "done",
      document: "done",
      liveness: "done",
      face_match: "failed",
      decision: "failed",
    });
  });

  test("in_review: unresolved checks and decision show review state", () => {
    const steps = deriveFlowSteps(
      verification("in_review", {
        document: "passed",
        liveness: "in_review",
        faceMatch: "passed",
      }),
    );
    const states = statesOf(steps);
    expect(states.liveness).toBe("review");
    expect(states.decision).toBe("review");
    expect(states.document).toBe("done");
  });

  test("expired/abandoned: decision failed, untouched checks stay waiting", () => {
    for (const status of ["expired", "abandoned"] as const) {
      const states = statesOf(deriveFlowSteps(verification(status, null)));
      expect(states.decision).toBe("failed");
      expect(states.document).toBe("waiting");
    }
  });

  test("every step carries a Japanese label", () => {
    for (const step of deriveFlowSteps(null)) {
      expect(step.label.length).toBeGreaterThan(0);
    }
  });
});
