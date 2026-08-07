import { Hono } from "hono";
import { pingDb } from "../db.js";

export const healthRoute = new Hono();

healthRoute.get("/healthz", async (c) => {
  try {
    await pingDb();
    return c.json({ status: "ok", db: "ok" });
  } catch (error) {
    console.error("Health check DB ping failed:", error);
    return c.json({ status: "error", db: "unreachable" }, 503);
  }
});
