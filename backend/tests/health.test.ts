import { describe, expect, it, vi } from "vitest";

const { pingDb, pool } = vi.hoisted(() => ({
  pingDb: vi.fn(),
  pool: {},
}));

vi.mock("../src/db.js", () => ({ pingDb, pool }));

const { app } = await import("../src/app.js");

describe("GET /healthz", () => {
  it("returns 200 with db ok when the DB ping succeeds", async () => {
    pingDb.mockResolvedValueOnce(undefined);

    const res = await app.request("/healthz");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 without throwing when the DB ping fails", async () => {
    pingDb.mockRejectedValueOnce(new Error("connection refused"));

    const res = await app.request("/healthz");

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      status: "error",
      db: "unreachable",
    });
  });
});
