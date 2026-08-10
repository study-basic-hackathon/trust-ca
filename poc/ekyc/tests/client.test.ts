import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createVerificationSession,
  DiditApiError,
  getSessionDecision,
} from "@/lib/didit/client";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.DIDIT_API_KEY = "test-api-key";
  process.env.DIDIT_WORKFLOW_ID = "wf-test";
  process.env.DIDIT_BASE_URL = "https://didit.example";
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createVerificationSession", () => {
  test("posts workflow, vendor_data, and callback, returns ids", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        session_id: "sess-1",
        url: "https://verify.didit.example/sess-1",
      }),
    );

    const session = await createVerificationSession({
      vendorData: "seller-1",
      callbackUrl: "http://localhost:3000/callback",
    });

    expect(session).toEqual({
      sessionId: "sess-1",
      sessionUrl: "https://verify.didit.example/sess-1",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://didit.example/v3/session/");
    expect(init.headers["x-api-key"]).toBe("test-api-key");
    expect(JSON.parse(init.body)).toEqual({
      workflow_id: "wf-test",
      vendor_data: "seller-1",
      callback: "http://localhost:3000/callback",
    });
  });

  test("accepts session_url as an alternative field name", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { session_id: "s", session_url: "https://u" }),
    );
    const session = await createVerificationSession({
      vendorData: "v",
      callbackUrl: "c",
    });
    expect(session.sessionUrl).toBe("https://u");
  });

  test("throws DiditApiError with the upstream message on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { detail: "Invalid API key" }),
    );
    await expect(
      createVerificationSession({ vendorData: "v", callbackUrl: "c" }),
    ).rejects.toThrowError(DiditApiError);
  });

  test("throws when the response lacks session_id or url", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { unexpected: true }));
    await expect(
      createVerificationSession({ vendorData: "v", callbackUrl: "c" }),
    ).rejects.toThrow(/missing session_id or url/);
  });
});

describe("getSessionDecision", () => {
  test("fetches the decision with the api key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { session_id: "sess-1", status: "Approved" }),
    );
    const decision = await getSessionDecision("sess-1");
    expect(decision.status).toBe("Approved");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://didit.example/v3/session/sess-1/decision/");
    expect(init.headers["x-api-key"]).toBe("test-api-key");
  });

  test("throws DiditApiError with status on 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: "Not found." }));
    await expect(getSessionDecision("missing")).rejects.toMatchObject({
      name: "DiditApiError",
      status: 404,
    });
  });

  test("handles non-JSON error bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(getSessionDecision("x")).rejects.toThrow(/HTTP 500/);
  });
});
