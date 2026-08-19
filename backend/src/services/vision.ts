import { GoogleAuth } from "google-auth-library";

export type VisionLabel = { description: string; score: number };
export type VisionObjectBoundingBox = { name: string; score: number };

export type VisionAnnotateResult = {
  ocrText: string;
  labels: VisionLabel[];
  objectBoundingBoxes: VisionObjectBoundingBox[];
};

export type VisionServiceErrorCode =
  | "VISION_API_UNAVAILABLE"
  | "VISION_API_CONFIGURATION_ERROR"
  | "VISION_AUTH_OR_SERVER_ERROR"
  | "VISION_ANALYSIS_ERROR";

export class VisionServiceError extends Error {
  constructor(
    public readonly code: VisionServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VisionServiceError";
  }
}

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;
type AccessTokenProvider = () => Promise<string>;

export type VisionServiceOptions = {
  apiBaseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  getAccessToken?: AccessTokenProvider;
  sleep?: Sleep;
};

let defaultAuth: GoogleAuth | null = null;
async function defaultGetAccessToken(): Promise<string> {
  defaultAuth ??= new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await defaultAuth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) {
    throw new VisionServiceError(
      "VISION_API_CONFIGURATION_ERROR",
      "Google ADCからaccess tokenを取得できませんでした。",
    );
  }
  return tokenResponse.token;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAnnotateResponse(body: unknown): VisionAnnotateResult {
  const responses = isRecord(body) && Array.isArray(body.responses)
    ? body.responses
    : [];
  const first = responses[0];
  if (!isRecord(first)) return { ocrText: "", labels: [], objectBoundingBoxes: [] };

  if (isRecord(first.error)) {
    throw new VisionServiceError(
      "VISION_ANALYSIS_ERROR",
      typeof first.error.message === "string"
        ? first.error.message
        : "Vision APIが画像を解析できませんでした。",
    );
  }

  const ocrText =
    isRecord(first.fullTextAnnotation) &&
    typeof first.fullTextAnnotation.text === "string"
      ? first.fullTextAnnotation.text
      : "";

  const labels: VisionLabel[] = Array.isArray(first.labelAnnotations)
    ? first.labelAnnotations
        .filter(isRecord)
        .map((label) => ({
          description: typeof label.description === "string" ? label.description : "",
          score: typeof label.score === "number" ? label.score : 0,
        }))
    : [];

  const objectBoundingBoxes: VisionObjectBoundingBox[] = Array.isArray(
    first.localizedObjectAnnotations,
  )
    ? first.localizedObjectAnnotations
        .filter(isRecord)
        .map((object) => ({
          name: typeof object.name === "string" ? object.name : "",
          score: typeof object.score === "number" ? object.score : 0,
        }))
    : [];

  return { ocrText, labels, objectBoundingBoxes };
}

export class VisionAnnotationService {
  private readonly fetchImpl: FetchLike;
  private readonly getAccessToken: AccessTokenProvider;
  private readonly sleep: Sleep;

  constructor(private readonly options: VisionServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getAccessToken = options.getAccessToken ?? defaultGetAccessToken;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async annotate(params: {
    bucket: string;
    objectKey: string;
  }): Promise<VisionAnnotateResult> {
    const accessToken = await this.getAccessToken();
    const gcsImageUri = `gs://${params.bucket}/${params.objectKey}`;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetchImpl(
          `${this.options.apiBaseUrl}/images:annotate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              requests: [
                {
                  image: { source: { gcsImageUri } },
                  features: [
                    { type: "TEXT_DETECTION", maxResults: 20 },
                    { type: "LABEL_DETECTION", maxResults: 20 },
                    { type: "OBJECT_LOCALIZATION", maxResults: 20 },
                  ],
                },
              ],
            }),
            signal: AbortSignal.timeout(this.options.timeoutMs),
          },
        );

        if (response.status === 401 || response.status === 403) {
          throw new VisionServiceError(
            "VISION_API_CONFIGURATION_ERROR",
            "Vision APIが認証情報を拒否しました。",
          );
        }

        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt === 0) {
            await this.sleep(150);
            continue;
          }
          if (response.status >= 500) {
            throw new VisionServiceError(
              "VISION_AUTH_OR_SERVER_ERROR",
              "Vision APIがサーバーエラーを返しました。",
            );
          }
          throw new VisionServiceError(
            "VISION_API_UNAVAILABLE",
            `Vision APIがHTTP ${response.status}を返しました。`,
          );
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          throw new VisionServiceError(
            "VISION_API_UNAVAILABLE",
            "Vision APIが不正なJSONを返しました。",
            error,
          );
        }

        return parseAnnotateResponse(body);
      } catch (error) {
        if (error instanceof VisionServiceError) throw error;
        lastError = error;
        if (attempt === 0) {
          await this.sleep(150);
          continue;
        }
      }
    }

    throw new VisionServiceError(
      "VISION_API_UNAVAILABLE",
      "Vision APIへのリクエストに失敗しました。",
      lastError,
    );
  }
}
