import { describe, expect, it } from "vitest";
import {
  extractChecks,
  isSellingAllowed,
  mapDiditStatus,
  normalizeDecision,
} from "../src/services/didit/normalize.js";

describe("mapDiditStatus", () => {
  it("既知のDiditステータスを正規化する", () => {
    expect(mapDiditStatus("Approved")).toBe("approved");
    expect(mapDiditStatus("Declined")).toBe("declined");
    expect(mapDiditStatus("In Review")).toBe("in_review");
    expect(mapDiditStatus("Awaiting User")).toBe("in_progress");
  });

  it("未知のステータスはin_reviewへフェイルセーフする", () => {
    expect(mapDiditStatus("Some Future Status")).toBe("in_review");
    expect(mapDiditStatus("")).toBe("in_review");
  });
});

describe("extractChecks", () => {
  it("各featureの最新結果を抽出する", () => {
    const checks = extractChecks({
      id_verifications: [{ status: "Approved" }],
      liveness_checks: [{ status: "Declined" }],
      face_matches: [],
      ip_analyses: [{ status: "Unknown" }],
    });

    expect(checks).toEqual({
      document: "passed",
      liveness: "failed",
      faceMatch: "not_run",
      ipAnalysis: "in_review",
    });
  });
});

describe("isSellingAllowed", () => {
  it("approvedだけを出品可能と判定する", () => {
    expect(isSellingAllowed("approved")).toBe(true);
    expect(isSellingAllowed("in_review")).toBe(false);
    expect(isSellingAllowed("declined")).toBe(false);
  });
});

describe("normalizeDecision", () => {
  it("session_idがない場合はエラーにする", () => {
    expect(() => normalizeDecision({})).toThrow();
  });

  it("decisionペイロード全体を正規化する", () => {
    const result = normalizeDecision({
      session_id: "session-1",
      status: "Approved",
      vendor_data: "seller-1",
      id_verifications: [{ status: "Approved" }],
    });

    expect(result.sessionId).toBe("session-1");
    expect(result.status).toBe("approved");
    expect(result.vendorData).toBe("seller-1");
    expect(result.checks.document).toBe("passed");
  });
});
