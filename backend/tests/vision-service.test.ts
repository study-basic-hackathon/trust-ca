import { describe, expect, it, vi } from "vitest";
import {
  VisionAnnotationService,
  VisionServiceError,
} from "../src/services/vision.js";

function successBody() {
  return {
    responses: [
      {
        fullTextAnnotation: { text: "Charizard ex\nSV1a 006/070" },
        labelAnnotations: [
          { description: "Trading card", score: 0.95 },
          { description: "Games", score: 0.8 },
        ],
        localizedObjectAnnotations: [{ name: "Card", score: 0.9 }],
      },
    ],
  };
}

function createService(fetchImpl: typeof fetch) {
  return new VisionAnnotationService({
    apiBaseUrl: "https://vision.googleapis.com/v1",
    timeoutMs: 1_000,
    fetchImpl,
    getAccessToken: vi.fn().mockResolvedValue("test-access-token"),
    sleep: vi.fn().mockResolvedValue(undefined),
  });
}

describe("VisionAnnotationService", () => {
  it("gs URIとBearerトークンでOCR・ラベル・領域検出を要求し、結果を正規化する", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(successBody())));
    const service = createService(fetchImpl);

    const result = await service.annotate({
      bucket: "trustca-card-images",
      objectKey: "card-images/abc.jpg",
    });

    expect(result).toEqual({
      ocrText: "Charizard ex\nSV1a 006/070",
      labels: [
        { description: "Trading card", score: 0.95 },
        { description: "Games", score: 0.8 },
      ],
      objectBoundingBoxes: [{ name: "Card", score: 0.9 }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-access-token",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init?.body as string);
    expect(body.requests[0].image.source.gcsImageUri).toBe(
      "gs://trustca-card-images/card-images/abc.jpg",
    );
    expect(body.requests[0].features.map((f: { type: string }) => f.type)).toEqual([
      "TEXT_DETECTION",
      "LABEL_DETECTION",
      "OBJECT_LOCALIZATION",
    ]);
  });

  it("欠落フィールドは空配列/空文字へフォールバックする", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ responses: [{}] })));
    const service = createService(fetchImpl);

    const result = await service.annotate({
      bucket: "b",
      objectKey: "k.jpg",
    });

    expect(result).toEqual({ ocrText: "", labels: [], objectBoundingBoxes: [] });
  });

  it("429を1回だけ再試行する", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successBody())));
    const service = createService(fetchImpl);

    await expect(
      service.annotate({ bucket: "b", objectKey: "k.jpg" }),
    ).resolves.toMatchObject({ ocrText: expect.any(String) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("再試行後も5xxが続く場合はサーバーエラーとして扱う", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const service = createService(fetchImpl);

    await expect(
      service.annotate({ bucket: "b", objectKey: "k.jpg" }),
    ).rejects.toMatchObject({ code: "VISION_AUTH_OR_SERVER_ERROR" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("ネットワーク障害が続く場合はunavailableにする", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network error"));
    const service = createService(fetchImpl);

    await expect(
      service.annotate({ bucket: "b", objectKey: "k.jpg" }),
    ).rejects.toMatchObject({ code: "VISION_API_UNAVAILABLE" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("401/403は再試行せず設定エラーにする", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const service = createService(fetchImpl);

    await expect(
      service.annotate({ bucket: "b", objectKey: "k.jpg" }),
    ).rejects.toMatchObject({ code: "VISION_API_CONFIGURATION_ERROR" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("画像単位のerrorは再試行せず解析エラーにする", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          responses: [{ error: { code: 3, message: "Bad image data." } }],
        }),
      ),
    );
    const service = createService(fetchImpl);

    const verification = service.annotate({ bucket: "b", objectKey: "k.jpg" });
    await expect(verification).rejects.toBeInstanceOf(VisionServiceError);
    await expect(verification).rejects.toMatchObject({
      code: "VISION_ANALYSIS_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
