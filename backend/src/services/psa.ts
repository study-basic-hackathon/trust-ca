export type PsaVerificationStatus =
  | "verified"
  | "not_found"
  | "invalid_request"
  | "in_review";

export type PsaCard = {
  certNumber: string;
  year: string | null;
  brand: string | null;
  category: string | null;
  cardNumber: string | null;
  subject: string | null;
  variety: string | null;
  gradeDescription: string | null;
  cardGrade: string | null;
  totalPopulation: number | null;
  populationHigher: number | null;
};

export type PsaVerification = {
  certNumber: string;
  status: PsaVerificationStatus;
  checkedAt: string;
  expiresAt: string;
  source: "psa";
  cacheHit: boolean;
  card?: PsaCard;
  reasonCode?:
    | "PSA_CERT_NOT_FOUND"
    | "PSA_CERT_INVALID"
    | "PSA_CERT_MISMATCH"
    | "PSA_CARD_DATA_UNAVAILABLE";
};

export type PsaServiceErrorCode =
  | "PSA_API_UNAVAILABLE"
  | "PSA_API_CONFIGURATION_ERROR"
  | "PSA_AUTH_OR_SERVER_ERROR";

export class PsaServiceError extends Error {
  constructor(
    public readonly code: PsaServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PsaServiceError";
  }
}

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

export type PsaServiceOptions = {
  apiBaseUrl: string;
  apiToken: string;
  timeoutMs: number;
  cacheTtlMs: number;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: Sleep;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createBaseResult(
  certNumber: string,
  status: PsaVerificationStatus,
  nowMs: number,
  cacheTtlMs: number,
): PsaVerification {
  return {
    certNumber,
    status,
    checkedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + cacheTtlMs).toISOString(),
    source: "psa",
    cacheHit: false,
  };
}

export function normalizePsaResponse(
  body: unknown,
  requestedCertNumber: string,
  nowMs: number,
  cacheTtlMs: number,
): PsaVerification {
  const base = (status: PsaVerificationStatus) =>
    createBaseResult(requestedCertNumber, status, nowMs, cacheTtlMs);

  if (!isRecord(body)) {
    return {
      ...base("in_review"),
      reasonCode: "PSA_CARD_DATA_UNAVAILABLE",
    };
  }

  const isValidRequest = body.IsValidRequest;
  const serverMessage = stringValue(body.ServerMessage)?.toLowerCase() ?? "";

  if (isValidRequest === false || serverMessage.includes("invalid cert")) {
    return {
      ...base("invalid_request"),
      reasonCode: "PSA_CERT_INVALID",
    };
  }

  if (serverMessage.includes("no data found")) {
    return {
      ...base("not_found"),
      reasonCode: "PSA_CERT_NOT_FOUND",
    };
  }

  const psaCert = body.PSACert;
  if (!isRecord(psaCert)) {
    return {
      ...base("in_review"),
      reasonCode: "PSA_CARD_DATA_UNAVAILABLE",
    };
  }

  const returnedCertNumber = stringValue(psaCert.CertNumber);
  if (returnedCertNumber !== requestedCertNumber) {
    return {
      ...base("in_review"),
      reasonCode: "PSA_CERT_MISMATCH",
    };
  }

  return {
    ...base("verified"),
    card: {
      certNumber: returnedCertNumber,
      year: stringValue(psaCert.Year),
      brand: stringValue(psaCert.Brand),
      category: stringValue(psaCert.Category),
      cardNumber: stringValue(psaCert.CardNumber),
      subject: stringValue(psaCert.Subject),
      variety: stringValue(psaCert.Variety),
      gradeDescription: stringValue(psaCert.GradeDescription),
      cardGrade: stringValue(psaCert.CardGrade),
      totalPopulation: numberValue(psaCert.TotalPopulation),
      populationHigher: numberValue(psaCert.PopulationHigher),
    },
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export class PsaVerificationService {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly cache = new Map<
    string,
    { expiresAtMs: number; result: PsaVerification }
  >();
  private readonly inflight = new Map<string, Promise<PsaVerification>>();

  constructor(private readonly options: PsaServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async verify(certNumber: string): Promise<PsaVerification> {
    if (!this.options.apiToken) {
      throw new PsaServiceError(
        "PSA_API_CONFIGURATION_ERROR",
        "PSA API token is not configured",
      );
    }

    const nowMs = this.now();
    const cached = this.cache.get(certNumber);
    if (cached && cached.expiresAtMs > nowMs) {
      return { ...cached.result, cacheHit: true };
    }
    if (cached) this.cache.delete(certNumber);

    const existingRequest = this.inflight.get(certNumber);
    if (existingRequest) return existingRequest;

    const request = this.fetchAndNormalize(certNumber).finally(() => {
      this.inflight.delete(certNumber);
    });
    this.inflight.set(certNumber, request);
    return request;
  }

  private async fetchAndNormalize(certNumber: string): Promise<PsaVerification> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetchImpl(
          `${this.options.apiBaseUrl}/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `bearer ${this.options.apiToken}`,
            },
            signal: AbortSignal.timeout(this.options.timeoutMs),
          },
        );

        if (response.status === 401 || response.status === 403) {
          throw new PsaServiceError(
            "PSA_API_CONFIGURATION_ERROR",
            "PSA API rejected the credentials",
          );
        }

        if (response.status === 204) {
          return this.storeIfCacheable(
            createBaseResult(
              certNumber,
              "invalid_request",
              this.now(),
              this.options.cacheTtlMs,
            ),
            "PSA_CERT_INVALID",
          );
        }

        if (response.status === 400) {
          return this.storeIfCacheable(
            createBaseResult(
              certNumber,
              "invalid_request",
              this.now(),
              this.options.cacheTtlMs,
            ),
            "PSA_CERT_INVALID",
          );
        }

        if (response.status === 404) {
          return this.storeIfCacheable(
            createBaseResult(
              certNumber,
              "not_found",
              this.now(),
              this.options.cacheTtlMs,
            ),
            "PSA_CERT_NOT_FOUND",
          );
        }

        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt === 0) {
            await this.sleep(150);
            continue;
          }
          if (response.status >= 500) {
            throw new PsaServiceError(
              "PSA_AUTH_OR_SERVER_ERROR",
              "PSA API returned a server error",
            );
          }
          throw new PsaServiceError(
            "PSA_API_UNAVAILABLE",
            `PSA API returned HTTP ${response.status}`,
          );
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          throw new PsaServiceError(
            "PSA_API_UNAVAILABLE",
            "PSA API returned invalid JSON",
            error,
          );
        }

        const result = normalizePsaResponse(
          body,
          certNumber,
          this.now(),
          this.options.cacheTtlMs,
        );
        return this.storeIfCacheable(result);
      } catch (error) {
        if (error instanceof PsaServiceError) throw error;
        lastError = error;
        if (attempt === 0) {
          await this.sleep(150);
          continue;
        }
      }
    }

    throw new PsaServiceError(
      "PSA_API_UNAVAILABLE",
      "PSA API request failed",
      lastError,
    );
  }

  private storeIfCacheable(
    result: PsaVerification,
    reasonCode?: PsaVerification["reasonCode"],
  ): PsaVerification {
    const enriched = reasonCode ? { ...result, reasonCode } : result;
    if (
      enriched.status === "verified" ||
      enriched.status === "not_found" ||
      enriched.status === "invalid_request"
    ) {
      this.cache.set(enriched.certNumber, {
        expiresAtMs: new Date(enriched.expiresAt).getTime(),
        result: enriched,
      });
    }
    return enriched;
  }
}
