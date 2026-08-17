import { Hono } from "hono";
import { cors } from "hono/cors";
import { pool } from "./db.js";
import {
  getOnchainConfig,
  getPaymentConfig,
  getPsaConfig,
} from "./env.js";
import { createFixedWindowRateLimiter } from "./middleware/rate-limit.js";
import { healthRoute } from "./routes/health.js";
import { createOnchainAnchorRoute } from "./routes/onchain-anchors.js";
import { createPaymentRoute } from "./routes/payments.js";
import { createPsaVerificationRoute } from "./routes/psa-verifications.js";
import { createWalletAuthRoute } from "./routes/wallet-auth.js";
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
app.route(
  "/",
  createOnchainAnchorRoute({ pool, config: getOnchainConfig() }),
);
const paymentConfig = getPaymentConfig();
app.route("/", createWalletAuthRoute({ pool, config: paymentConfig }));
app.route("/", createPaymentRoute({ pool, config: paymentConfig }));
