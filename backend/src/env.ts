export type PsaConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  apiToken: string;
  timeoutMs: number;
  cacheTtlMs: number;
  requestsPerMinute: number;
};

export type OnchainConfig = {
  enabled: boolean;
  rpcUrl: string;
  chainId: number;
  chainName: string;
  contractAddress: `0x${string}`;
  operatorPrivateKey: `0x${string}`;
  confirmations: number;
  receiptTimeoutMs: number;
  pollIntervalMs: number;
  batchSize: number;
  lockTimeoutSeconds: number;
  maxAttempts: number;
  workerId: string;
  internalToken: string;
};

export type PaymentConfig = {
  enabled: boolean;
  rpcUrl: string;
  chainId: number;
  chainName: string;
  tokenAddress: `0x${string}`;
  expectedSymbol: string;
  confirmations: number;
  pollIntervalMs: number;
  batchSize: number;
  lockTimeoutSeconds: number;
  verificationTimeoutSeconds: number;
  intentLifetimeSeconds: number;
  /** pending_paymentのまま放置された予約を解放するまでの猶予(秒) */
  reservationTtlSeconds: number;
  workerId: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  siweDomain: string;
  siweUri: string;
  challengeTtlSeconds: number;
};

export type DiditConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  workflowId: string;
  webhookSecret: string;
};

export type AdminConfig = {
  token: string;
};

export type VisionConfig = {
  enabled: boolean;
  storageBucket: string;
  apiBaseUrl: string;
  timeoutMs: number;
  uploadUrlTtlSeconds: number;
  adminToken: string;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name}には正の整数を指定してください。`);
  }
  return parsed;
}

function positiveIntegerOrFallback(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}が未設定です。`);
  return value;
}

export function getPsaConfig(): PsaConfig {
  return {
    enabled: process.env.PSA_MVP_ENABLED === "true",
    apiBaseUrl: (
      process.env.PSA_API_BASE_URL ?? "https://api.psacard.com/publicapi"
    ).replace(/\/$/, ""),
    apiToken: process.env.PSA_API_TOKEN ?? "",
    timeoutMs: positiveIntegerOrFallback("PSA_API_TIMEOUT_MS", 5_000),
    cacheTtlMs:
      positiveIntegerOrFallback("PSA_CACHE_TTL_SECONDS", 86_400) * 1_000,
    requestsPerMinute: positiveIntegerOrFallback(
      "PSA_REQUESTS_PER_MINUTE",
      10,
    ),
  };
}

export function getOnchainConfig(): OnchainConfig {
  const enabled = process.env.ONCHAIN_MVP_ENABLED === "true";
  const rpcUrl = process.env.ONCHAIN_RPC_URL?.trim() ?? "";
  const contractAddress = process.env.ONCHAIN_ANCHOR_CONTRACT?.trim() ?? "";
  const operatorPrivateKey =
    process.env.ONCHAIN_OPERATOR_PRIVATE_KEY?.trim() ?? "";
  const internalToken = process.env.ONCHAIN_INTERNAL_TOKEN?.trim() ?? "";

  if (enabled) {
    required("ONCHAIN_RPC_URL");
    required("ONCHAIN_ANCHOR_CONTRACT");
    required("ONCHAIN_OPERATOR_PRIVATE_KEY");
    required("ONCHAIN_INTERNAL_TOKEN");
    if (!ADDRESS_PATTERN.test(contractAddress)) {
      throw new Error("ONCHAIN_ANCHOR_CONTRACTの形式が不正です。");
    }
    if (!PRIVATE_KEY_PATTERN.test(operatorPrivateKey)) {
      throw new Error("ONCHAIN_OPERATOR_PRIVATE_KEYの形式が不正です。");
    }
    if (internalToken.length < 32) {
      throw new Error("ONCHAIN_INTERNAL_TOKENは32文字以上で指定してください。");
    }
  }

  return {
    enabled,
    rpcUrl,
    chainId: positiveInteger("ONCHAIN_CHAIN_ID", 31_337),
    chainName: process.env.ONCHAIN_CHAIN_NAME?.trim() || "Trustca Local",
    contractAddress: contractAddress.toLowerCase() as `0x${string}`,
    operatorPrivateKey: operatorPrivateKey as `0x${string}`,
    confirmations: positiveInteger("ONCHAIN_CONFIRMATIONS", 1),
    receiptTimeoutMs: positiveInteger("ONCHAIN_RECEIPT_TIMEOUT_MS", 60_000),
    pollIntervalMs: positiveInteger("ONCHAIN_POLL_INTERVAL_MS", 3_000),
    batchSize: positiveInteger("ONCHAIN_BATCH_SIZE", 5),
    lockTimeoutSeconds: positiveInteger("ONCHAIN_LOCK_TIMEOUT_SECONDS", 120),
    maxAttempts: positiveInteger("ONCHAIN_MAX_ATTEMPTS", 8),
    workerId:
      process.env.ONCHAIN_WORKER_ID?.trim() ||
      `worker-${process.pid}-${Date.now().toString(36)}`,
    internalToken,
  };
}

export function getPaymentConfig(): PaymentConfig {
  const enabled = process.env.PAYMENT_MVP_ENABLED === "true";
  const rpcUrl = process.env.PAYMENT_RPC_URL?.trim() ?? "";
  const tokenAddress = process.env.PAYMENT_JPYC_TOKEN_ADDRESS?.trim() ?? "";
  const sessionSecret = process.env.PAYMENT_SESSION_SECRET?.trim() ?? "";
  const siweDomain = process.env.PAYMENT_SIWE_DOMAIN?.trim() ?? "";
  const siweUri = process.env.PAYMENT_SIWE_URI?.trim() ?? "";

  if (enabled) {
    required("PAYMENT_RPC_URL");
    required("PAYMENT_JPYC_TOKEN_ADDRESS");
    required("PAYMENT_SESSION_SECRET");
    required("PAYMENT_SIWE_DOMAIN");
    required("PAYMENT_SIWE_URI");
    if (!ADDRESS_PATTERN.test(tokenAddress)) {
      throw new Error("PAYMENT_JPYC_TOKEN_ADDRESSの形式が不正です。");
    }
    if (sessionSecret.length < 32) {
      throw new Error("PAYMENT_SESSION_SECRETは32文字以上で指定してください。");
    }
    let parsedUri: URL;
    try {
      parsedUri = new URL(siweUri);
    } catch {
      throw new Error("PAYMENT_SIWE_URIの形式が不正です。");
    }
    if (parsedUri.host !== siweDomain) {
      throw new Error("PAYMENT_SIWE_DOMAINとPAYMENT_SIWE_URIのhostが一致しません。");
    }
  }

  return {
    enabled,
    rpcUrl,
    chainId: positiveInteger("PAYMENT_CHAIN_ID", 137),
    chainName: process.env.PAYMENT_CHAIN_NAME?.trim() || "Polygon",
    tokenAddress: tokenAddress.toLowerCase() as `0x${string}`,
    expectedSymbol: process.env.PAYMENT_EXPECTED_SYMBOL?.trim() || "JPYC",
    confirmations: positiveInteger("PAYMENT_CONFIRMATIONS", 12),
    pollIntervalMs: positiveInteger("PAYMENT_POLL_INTERVAL_MS", 3_000),
    batchSize: positiveInteger("PAYMENT_BATCH_SIZE", 5),
    lockTimeoutSeconds: positiveInteger("PAYMENT_LOCK_TIMEOUT_SECONDS", 120),
    verificationTimeoutSeconds: positiveInteger(
      "PAYMENT_VERIFICATION_TIMEOUT_SECONDS",
      3_600,
    ),
    intentLifetimeSeconds: positiveInteger(
      "PAYMENT_INTENT_LIFETIME_SECONDS",
      900,
    ),
    // intentの寿命(既定900秒)より十分長くし、支払い中の予約を誤って解放しない
    reservationTtlSeconds: positiveInteger(
      "ORDER_RESERVATION_TTL_SECONDS",
      1_800,
    ),
    workerId:
      process.env.PAYMENT_WORKER_ID?.trim() ||
      `payment-worker-${process.pid}-${Date.now().toString(36)}`,
    sessionSecret,
    sessionTtlSeconds: positiveInteger("PAYMENT_SESSION_TTL_SECONDS", 3_600),
    siweDomain,
    siweUri,
    challengeTtlSeconds: positiveInteger("PAYMENT_CHALLENGE_TTL_SECONDS", 300),
  };
}

export function getDiditConfig(): DiditConfig {
  const enabled = process.env.DIDIT_MVP_ENABLED === "true";
  const apiKey = process.env.DIDIT_API_KEY?.trim() ?? "";
  const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim() ?? "";
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET_KEY?.trim() ?? "";

  if (enabled) {
    required("DIDIT_API_KEY");
    required("DIDIT_WORKFLOW_ID");
    required("DIDIT_WEBHOOK_SECRET_KEY");
  }

  return {
    enabled,
    baseUrl:
      process.env.DIDIT_BASE_URL?.trim() || "https://verification.didit.me",
    apiKey,
    workflowId,
    webhookSecret,
  };
}

export function getAdminConfig(): AdminConfig {
  const token = process.env.ADMIN_API_TOKEN?.trim() ?? "";
  if (token && token.length < 32) {
    throw new Error("ADMIN_API_TOKENは32文字以上で指定してください。");
  }
  return { token };
}

export function getVisionConfig(): VisionConfig {
  const enabled = process.env.VISION_MVP_ENABLED === "true";
  const storageBucket = process.env.VISION_STORAGE_BUCKET?.trim() ?? "";
  const adminToken = process.env.VISION_ADMIN_TOKEN?.trim() ?? "";

  if (enabled) {
    required("VISION_STORAGE_BUCKET");
    required("VISION_ADMIN_TOKEN");
    if (adminToken.length < 32) {
      throw new Error("VISION_ADMIN_TOKENは32文字以上で指定してください。");
    }
  }

  return {
    enabled,
    storageBucket,
    apiBaseUrl: (
      process.env.VISION_API_BASE_URL ?? "https://vision.googleapis.com/v1"
    ).replace(/\/$/, ""),
    timeoutMs: positiveIntegerOrFallback("VISION_API_TIMEOUT_MS", 10_000),
    uploadUrlTtlSeconds: positiveIntegerOrFallback(
      "VISION_UPLOAD_URL_TTL_SECONDS",
      900,
    ),
    adminToken,
  };
}
