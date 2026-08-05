type RequiredKey = "DIDIT_API_KEY" | "DIDIT_WORKFLOW_ID";

export function getRequiredEnv(key: RequiredKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Environment variable ${key} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function getDiditBaseUrl(): string {
  return process.env.DIDIT_BASE_URL ?? "https://verification.didit.me";
}

export function getWebhookSecret(): string | null {
  return process.env.DIDIT_WEBHOOK_SECRET_KEY ?? null;
}

export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}
