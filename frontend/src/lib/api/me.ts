import { api } from "@/lib/api";

export type KycChecks = Record<string, string>;

export type MeView = {
  userId: string;
  wallet: { address: string; chainId: number };
  seller: {
    id: string;
    displayName: string;
    onboardingStatus: string;
  } | null;
  verification: {
    sessionId: string;
    status: string;
    checks: KycChecks | null;
    decidedAt: string | null;
  } | null;
  isSellingAllowed: boolean;
};

export type VerificationEventView = {
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  source: string;
  reason: string | null;
  createdAt: string;
};

export type VerificationView = {
  verification: {
    sessionId: string;
    status: string;
    checks: KycChecks | null;
    sessionUrl: string | null;
    requestedAt: string;
    decidedAt: string | null;
  } | null;
  isSellingAllowed: boolean;
  events: VerificationEventView[];
};

export function getMe(token: string): Promise<MeView> {
  return api<MeView>("/api/v1/me", {}, token);
}

export function registerSeller(
  token: string,
  displayName: string,
): Promise<{ id: string; displayName: string; onboardingStatus: string }> {
  return api(
    "/api/v1/sellers",
    { method: "POST", body: JSON.stringify({ displayName }) },
    token,
  );
}

export function startKycSession(
  token: string,
  sellerId: string,
): Promise<{ sessionId: string; sessionUrl: string; status: string }> {
  return api(
    `/api/v1/sellers/${encodeURIComponent(sellerId)}/kyc-sessions`,
    { method: "POST" },
    token,
  );
}

export function getVerification(
  sellerId: string,
  options: { refresh?: boolean; token?: string } = {},
): Promise<VerificationView> {
  const query = options.refresh ? "?refresh=1" : "";
  return api<VerificationView>(
    `/api/v1/sellers/${encodeURIComponent(sellerId)}/verification${query}`,
    {},
    options.token,
  );
}
