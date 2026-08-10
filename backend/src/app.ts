import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoute } from "./routes/health.js";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  }),
);

app.route("/", healthRoute);
