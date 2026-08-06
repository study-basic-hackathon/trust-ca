import { beforeAll, afterAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ekyc-db-test-"));
process.env.EKYC_DB_PATH = path.join(tempDir, "test.db");

// Import AFTER the env override so the connection uses the temp file.
const db = await import("@/lib/db");

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("sellers", () => {
  test("creates and reads back a seller", () => {
    const seller = db.createSeller("Test Seller");
    expect(seller.displayName).toBe("Test Seller");
    expect(seller.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.getSellerById(seller.id)).toEqual(seller);
  });

  test("returns null for an unknown seller id", () => {
    expect(db.getSellerById("nope")).toBeNull();
  });
});

describe("seller_verifications", () => {
  let sellerId: string;

  beforeAll(() => {
    sellerId = db.createSeller("Verification Seller").id;
  });

  test("creates a verification in not_started state", () => {
    db.createVerification({ sessionId: "sess-a", sellerId });
    const found = db.getVerificationBySessionId("sess-a");
    expect(found?.status).toBe("not_started");
    expect(found?.sellerId).toBe(sellerId);
    expect(found?.checks).toBeNull();
    expect(found?.source).toBe("created");
  });

  test("updates status and checks", () => {
    const checks = {
      document: "passed",
      liveness: "passed",
      faceMatch: "passed",
      ipAnalysis: "not_run",
    } as const;
    const updated = db.updateVerification({
      sessionId: "sess-a",
      status: "approved",
      checks,
      source: "webhook",
    });
    expect(updated).toBe(true);
    const found = db.getVerificationBySessionId("sess-a");
    expect(found?.status).toBe("approved");
    expect(found?.checks).toEqual(checks);
    expect(found?.source).toBe("webhook");
  });

  test("update returns false for an unknown session", () => {
    expect(
      db.updateVerification({
        sessionId: "missing",
        status: "approved",
        checks: null,
        source: "poll",
      }),
    ).toBe(false);
  });

  test("returns the latest verification for a seller", () => {
    db.createVerification({ sessionId: "sess-b", sellerId });
    const latest = db.getLatestVerificationForSeller(sellerId);
    expect(latest?.sessionId).toBe("sess-b");
  });

  test("returns null when the seller has no verifications", () => {
    const fresh = db.createSeller("No KYC Yet");
    expect(db.getLatestVerificationForSeller(fresh.id)).toBeNull();
  });
});

describe("webhook_logs", () => {
  test("stores and lists logs, newest first, without raw payloads", () => {
    db.insertWebhookLog({
      sessionId: "sess-a",
      status: "Approved",
      signatureMethod: "v2",
      isSignatureValid: true,
      rawPayload: '{"session_id":"sess-a"}',
    });
    db.insertWebhookLog({
      sessionId: "sess-x",
      status: "Declined",
      signatureMethod: null,
      isSignatureValid: false,
      rawPayload: "{}",
    });
    const logs = db.getRecentWebhookLogs(10);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0].sessionId).toBe("sess-x");
    expect(logs[0].isSignatureValid).toBe(false);
    expect(logs[1].isSignatureValid).toBe(true);
    expect("rawPayload" in logs[0]).toBe(false);
  });
});

describe("verification_events", () => {
  test("session creation records a session_created event", () => {
    const seller = db.createSeller("Event Seller");
    db.createVerification({ sessionId: "sess-ev", sellerId: seller.id });
    const events = db.getEventsForSession("sess-ev");
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("session_created");
    expect(events[0].toStatus).toBe("not_started");
  });

  test("status change records a status_changed event with from/to", () => {
    db.updateVerification({
      sessionId: "sess-ev",
      status: "in_progress",
      checks: null,
      source: "poll",
    });
    const events = db.getEventsForSession("sess-ev");
    expect(events).toHaveLength(2);
    const latest = events[events.length - 1];
    expect(latest.eventType).toBe("status_changed");
    expect(latest.fromStatus).toBe("not_started");
    expect(latest.toStatus).toBe("in_progress");
    expect(latest.source).toBe("poll");
  });

  test("checks-only change records a checks_updated event", () => {
    const checks = {
      document: "passed",
      liveness: "not_run",
      faceMatch: "not_run",
      ipAnalysis: "not_run",
    } as const;
    db.updateVerification({
      sessionId: "sess-ev",
      status: "in_progress",
      checks,
      source: "poll",
    });
    const events = db.getEventsForSession("sess-ev");
    expect(events).toHaveLength(3);
    expect(events[events.length - 1].eventType).toBe("checks_updated");
    expect(events[events.length - 1].checks).toEqual(checks);
  });

  test("no-op update does not record an event", () => {
    const before = db.getEventsForSession("sess-ev").length;
    db.updateVerification({
      sessionId: "sess-ev",
      status: "in_progress",
      checks: {
        document: "passed",
        liveness: "not_run",
        faceMatch: "not_run",
        ipAnalysis: "not_run",
      },
      source: "poll",
    });
    expect(db.getEventsForSession("sess-ev")).toHaveLength(before);
  });

  test("events for an unknown session are empty", () => {
    expect(db.getEventsForSession("nope")).toEqual([]);
  });
});
