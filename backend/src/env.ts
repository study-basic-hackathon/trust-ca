export type PsaConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  apiToken: string;
  timeoutMs: number;
  cacheTtlMs: number;
  requestsPerMinute: number;
};

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPsaConfig(): PsaConfig {
  return {
    enabled: process.env.PSA_MVP_ENABLED === "true",
    apiBaseUrl: (
      process.env.PSA_API_BASE_URL ?? "https://api.psacard.com/publicapi"
    ).replace(/\/$/, ""),
    apiToken: process.env.PSA_API_TOKEN ?? "",
    timeoutMs: readPositiveInteger("PSA_API_TIMEOUT_MS", 5_000),
    cacheTtlMs: readPositiveInteger("PSA_CACHE_TTL_SECONDS", 86_400) * 1_000,
    requestsPerMinute: readPositiveInteger("PSA_REQUESTS_PER_MINUTE", 10),
  };
}
