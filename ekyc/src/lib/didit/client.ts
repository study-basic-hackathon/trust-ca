import { getDiditBaseUrl, getRequiredEnv } from "@/lib/env";

const REQUEST_TIMEOUT_MS = 15_000;

export type CreatedSession = {
  sessionId: string;
  sessionUrl: string;
};

export class DiditApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DiditApiError";
    this.status = status;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as Record<string, unknown>;
    return String(data.message ?? data.error ?? data.detail ?? JSON.stringify(data));
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Create a hosted verification session. The returned URL is where the
 * seller completes document capture, liveness, and face match.
 */
export async function createVerificationSession(input: {
  vendorData: string;
  callbackUrl: string;
}): Promise<CreatedSession> {
  const response = await fetch(`${getDiditBaseUrl()}/v3/session/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getRequiredEnv("DIDIT_API_KEY"),
    },
    body: JSON.stringify({
      workflow_id: getRequiredEnv("DIDIT_WORKFLOW_ID"),
      vendor_data: input.vendorData,
      callback: input.callbackUrl,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new DiditApiError(
      `Didit session creation failed: ${await readErrorMessage(response)}`,
      response.status,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const sessionId = data.session_id;
  const sessionUrl = data.url ?? data.session_url;

  if (typeof sessionId !== "string" || typeof sessionUrl !== "string") {
    throw new DiditApiError(
      "Didit session response is missing session_id or url",
      response.status,
    );
  }

  return { sessionId, sessionUrl };
}

/**
 * Fetch the full decision report for a session. Canonical read endpoint —
 * used both after webhooks and as a polling fallback for local development
 * where webhooks cannot reach localhost.
 */
export async function getSessionDecision(
  sessionId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${getDiditBaseUrl()}/v3/session/${encodeURIComponent(sessionId)}/decision/`,
    {
      method: "GET",
      headers: {
        "x-api-key": getRequiredEnv("DIDIT_API_KEY"),
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new DiditApiError(
      `Didit decision fetch failed: ${await readErrorMessage(response)}`,
      response.status,
    );
  }

  return (await response.json()) as Record<string, unknown>;
}
