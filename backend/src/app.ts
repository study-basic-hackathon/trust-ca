import { Hono } from "hono";
import { cors } from "hono/cors";
import { getPsaConfig } from "./env.js";
import { createFixedWindowRateLimiter } from "./middleware/rate-limit.js";
import { healthRoute } from "./routes/health.js";
import { createPsaVerificationRoute } from "./routes/psa-verifications.js";
import { PsaVerificationService } from "./services/psa.js";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  }),
);

app.route("/", healthRoute);

const psaConfig = getPsaConfig();
const psaService = new PsaVerificationService(psaConfig);
app.route(
  "/",
  createPsaVerificationRoute({
    config: psaConfig,
    service: psaService,
    rateLimiter: createFixedWindowRateLimiter(psaConfig.requestsPerMinute),
  }),
);
