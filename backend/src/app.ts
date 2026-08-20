import { Hono } from "hono";
import { cors } from "hono/cors";
import { pool } from "./db.js";
import {
  getAdminConfig,
  getDiditConfig,
  getOnchainConfig,
  getPaymentConfig,
  getPsaConfig,
  getVisionConfig,
} from "./env.js";
import { createFixedWindowRateLimiter } from "./middleware/rate-limit.js";
import { createAdminVerificationRoute } from "./routes/admin-verifications.js";
import { createCardImageAnalysesRoute } from "./routes/card-image-analyses.js";
import { createCardImagesRoute } from "./routes/card-images.js";
import { createCardImageUploadsRoute } from "./routes/card-image-uploads.js";
import { healthRoute } from "./routes/health.js";
import { createCardsRoute } from "./routes/cards.js";
import { createKycRoute } from "./routes/kyc.js";
import { createListingsRoute } from "./routes/listings.js";
import { createMeRoute } from "./routes/me.js";
import { createOnchainAnchorRoute } from "./routes/onchain-anchors.js";
import { createOrdersRoute } from "./routes/orders.js";
import { createPaymentRoute } from "./routes/payments.js";
import { createPsaVerificationRoute } from "./routes/psa-verifications.js";
import { createSellerRoute } from "./routes/sellers.js";
import { createWalletAuthRoute } from "./routes/wallet-auth.js";
import { createWebhookRoute } from "./routes/webhooks.js";
import { PsaVerificationService } from "./services/psa.js";
import { VisionAnnotationService } from "./services/vision.js";

const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: frontendOrigin,
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
    pool,
  }),
);
const onchainConfig = getOnchainConfig();
app.route("/", createOnchainAnchorRoute({ pool, config: onchainConfig }));
const paymentConfig = getPaymentConfig();
app.route("/", createWalletAuthRoute({ pool, config: paymentConfig }));
app.route("/", createPaymentRoute({ pool, config: paymentConfig }));

app.route(
  "/",
  createCardsRoute({ pool, walletConfig: paymentConfig }),
);
app.route(
  "/",
  createOrdersRoute({ pool, walletConfig: paymentConfig, onchainConfig }),
);

const diditConfig = getDiditConfig();
app.route("/", createSellerRoute({ pool, walletConfig: paymentConfig }));
app.route(
  "/",
  createMeRoute({ pool, walletConfig: paymentConfig, diditConfig }),
);
app.route(
  "/",
  createKycRoute({
    pool,
    diditConfig,
    walletConfig: paymentConfig,
    frontendOrigin,
  }),
);
app.route("/", createWebhookRoute({ pool, diditConfig }));
app.route(
  "/",
  createAdminVerificationRoute({ pool, adminConfig: getAdminConfig() }),
);

const visionConfig = getVisionConfig();
app.route(
  "/",
  createListingsRoute({ pool, walletConfig: paymentConfig, visionConfig }),
);
const visionService = new VisionAnnotationService({
  apiBaseUrl: visionConfig.apiBaseUrl,
  timeoutMs: visionConfig.timeoutMs,
});
app.route(
  "/",
  createCardImageUploadsRoute({ visionConfig, paymentConfig }),
);
app.route(
  "/",
  createCardImagesRoute({ pool, visionConfig, paymentConfig }),
);
app.route(
  "/",
  createCardImageAnalysesRoute({
    pool,
    visionConfig,
    paymentConfig,
    visionService,
  }),
);
