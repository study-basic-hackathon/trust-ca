import { describe, expect, test } from "vitest";
import {
  mapDiditStatus,
  extractChecks,
  isSellingAllowed,
  normalizeDecision,
} from "@/lib/didit/normalize";

describe("mapDiditStatus", () => {
  test.each([
    ["Not Started", "not_started"],
    ["In Progress", "in_progress"],
    ["Awaiting User", "in_progress"],
    ["Resubmitted", "in_progress"],
    ["In Review", "in_review"],
    ["Approved", "approved"],
    ["Declined", "declined"],
    ["Abandoned", "abandoned"],
    ["Expired", "expired"],
    ["Kyc Expired", "expired"],
  ])("maps %s to %s", (didit, internal) => {
    expect(mapDiditStatus(didit)).toBe(internal);
  });

  test("maps unknown statuses to in_review (fail-safe, never auto-approve)", () => {
    expect(mapDiditStatus("Some Future Status")).toBe("in_review");
    expect(mapDiditStatus("")).toBe("in_review");
  });
});

describe("extractChecks", () => {
  test("extracts per-feature results from a decision report", () => {
    const decision = {
      id_verifications: [{ status: "Approved", node_id: "n1" }],
      liveness_checks: [{ status: "Approved", node_id: "n2" }],
      face_matches: [{ status: "Declined", node_id: "n3" }],
      ip_analyses: [{ status: "In Review", node_id: "n4" }],
    };
    expect(extractChecks(decision)).toEqual({
      document: "passed",
      liveness: "passed",
      faceMatch: "failed",
      ipAnalysis: "in_review",
    });
  });

  test("reports not_run for features that never executed (null or missing)", () => {
    expect(extractChecks({ id_verifications: null })).toEqual({
      document: "not_run",
      liveness: "not_run",
      faceMatch: "not_run",
      ipAnalysis: "not_run",
    });
    expect(extractChecks({})).toEqual({
      document: "not_run",
      liveness: "not_run",
      faceMatch: "not_run",
      ipAnalysis: "not_run",
    });
  });

  test("uses the latest entry when a feature ran more than once", () => {
    const decision = {
      id_verifications: [
        { status: "Declined", node_id: "n1" },
        { status: "Approved", node_id: "n1-retry" },
      ],
    };
    expect(extractChecks(decision).document).toBe("passed");
  });

  test("maps Not Finished and unknown feature statuses to in_review", () => {
    const decision = {
      liveness_checks: [{ status: "Not Finished", node_id: "n2" }],
      face_matches: [{ status: "Mystery", node_id: "n3" }],
    };
    const checks = extractChecks(decision);
    expect(checks.liveness).toBe("in_review");
    expect(checks.faceMatch).toBe("in_review");
  });
});

describe("isSellingAllowed", () => {
  test("only approved sellers can sell", () => {
    expect(isSellingAllowed("approved")).toBe(true);
    for (const status of [
      "not_started",
      "in_progress",
      "in_review",
      "declined",
      "abandoned",
      "expired",
    ] as const) {
      expect(isSellingAllowed(status)).toBe(false);
    }
  });
});

describe("normalizeDecision", () => {
  test("builds the full internal record from a Didit decision payload", () => {
    const decision = {
      session_id: "sess-1",
      status: "Approved",
      vendor_data: "seller_42",
      id_verifications: [{ status: "Approved" }],
      liveness_checks: [{ status: "Approved" }],
      face_matches: [{ status: "Approved" }],
      ip_analyses: null,
    };
    const record = normalizeDecision(decision);
    expect(record).toEqual({
      sessionId: "sess-1",
      status: "approved",
      vendorData: "seller_42",
      checks: {
        document: "passed",
        liveness: "passed",
        faceMatch: "passed",
        ipAnalysis: "not_run",
      },
    });
  });

  test("throws on a payload without a session_id", () => {
    expect(() => normalizeDecision({ status: "Approved" })).toThrow();
  });
});
