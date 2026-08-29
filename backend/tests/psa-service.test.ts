import { describe, expect, it, vi } from "vitest";
import {
  normalizePsaResponse,
  PsaServiceError,
  PsaVerificationService,
} from "../src/services/psa.js";

const NOW = Date.parse("2026-08-13T00:00:00.000Z");
const TTL = 86_400_000;

function successBody(certNumber = "12345678") {
  return {
    IsValidRequest: true,
    ServerMessage: "Request successful",
    PSACert: {
      CertNumber: certNumber,
      Year: "1999",
      Brand: "POKEMON GAME",
      Category: "TCG Cards",
      CardNumber: "4",
      Subject: "CHARIZARD",
      Variety: "HOLO",
      GradeDescription: "GEM MINT",
      CardGrade: "10",
      TotalPopulation: 712,
      PopulationHigher: 0,
      IgnoredField: "レスポンスへ転記しない",
    },
  };
}

function createService(fetchImpl: typeof fetch) {
  return new PsaVerificationService({
    apiBaseUrl: "https://api.example.test/publicapi",
    apiToken: "secret-token",
    timeoutMs: 1_000,
    cacheTtlMs: TTL,
    fetchImpl,
    now: () => NOW,
    sleep: vi.fn().mockResolvedValue(undefined),
  });
}

describe("PsaVerificationService モック", () => {
  function createMockService() {
    return new PsaVerificationService({
      apiBaseUrl: "https://api.example.test/publicapi",
      apiToken: "", // モックはトークン不要
      timeoutMs: 1_000,
      cacheTtlMs: TTL,
      mockEnabled: true,
      fetchImpl: vi.fn(), // 呼ばれないことを検証する
      now: () => NOW,
      sleep: vi.fn().mockResolvedValue(undefined),
    });
  }

  it("実APIを呼ばずverifiedのサンプルカードを返す", async () => {
    const fetchImpl = vi.fn();
    const service = new PsaVerificationService({
      apiBaseUrl: "https://api.example.test/publicapi",
      apiToken: "",
      timeoutMs: 1_000,
      cacheTtlMs: TTL,
      mockEnabled: true,
      fetchImpl,
      now: () => NOW,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const result = await service.verify("12345678");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("verified");
    expect(result.card?.certNumber).toBe("12345678");
    expect(result.card?.subject).toContain("CHARIZARD");
  });

  it("すべて0の証明書番号はnot_foundを返す(負のパス確認)", async () => {
    const result = await createMockService().verify("00000000");
    expect(result.status).toBe("not_found");
    expect(result.reasonCode).toBe("PSA_CERT_NOT_FOUND");
  });
});

describe("normalizePsaResponse", () => {
  it("PSACertの許可済みフィールドだけをverifiedへ正規化する", () => {
    const result = normalizePsaResponse(successBody(), "12345678", NOW, TTL);

    expect(result).toEqual({
      certNumber: "12345678",
      status: "verified",
      checkedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-14T00:00:00.000Z",
      source: "psa",
      cacheHit: false,
      card: {
        certNumber: "12345678",
        year: "1999",
        brand: "POKEMON GAME",
        category: "TCG Cards",
        cardNumber: "4",
        subject: "CHARIZARD",
        variety: "HOLO",
        gradeDescription: "GEM MINT",
        cardGrade: "10",
        totalPopulation: 712,
        populationHigher: 0,
      },
    });
    expect(result.card).not.toHaveProperty("IgnoredField");
  });

  it.each([
    [
      { IsValidRequest: true, ServerMessage: "No data found" },
      "not_found",
      "PSA_CERT_NOT_FOUND",
    ],
    [
      { IsValidRequest: false, ServerMessage: "Invalid CertNo" },
      "invalid_request",
      "PSA_CERT_INVALID",
    ],
    [
      { IsValidRequest: true, DNACert: { CertNumber: "12345678" } },
      "in_review",
      "PSA_CARD_DATA_UNAVAILABLE",
    ],
    [successBody("87654321"), "in_review", "PSA_CERT_MISMATCH"],
  ])("曖昧な結果を承認扱いにしない", (body, status, reasonCode) => {
    expect(normalizePsaResponse(body, "12345678", NOW, TTL)).toMatchObject({
      status,
      reasonCode,
    });
  });
});

describe("PsaVerificationService", () => {
  it("Bearerヘッダーと証明書番号を使い、成功結果をキャッシュする", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(successBody())));
    const service = createService(fetchImpl);

    const first = await service.verify("12345678");
    const second = await service.verify("12345678");

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/publicapi/cert/GetByCertNumber/12345678",
      expect.objectContaining({
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "bearer secret-token",
        },
      }),
    );
  });

  it("同一番号の同時照会を1リクエストへまとめる", async () => {
    let resolveResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(pending);
    const service = createService(fetchImpl);

    const first = service.verify("12345678");
    const second = service.verify("12345678");
    resolveResponse(new Response(JSON.stringify(successBody())));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("429を1回だけ再試行する", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successBody())));
    const service = createService(fetchImpl);

    await expect(service.verify("12345678")).resolves.toMatchObject({
      status: "verified",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("ネットワーク障害が続く場合はunavailableにする", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network error"));
    const service = createService(fetchImpl);

    await expect(service.verify("12345678")).rejects.toMatchObject({
      code: "PSA_API_UNAVAILABLE",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("401は再試行せず設定エラーにする", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const service = createService(fetchImpl);

    const verification = service.verify("12345678");
    await expect(verification).rejects.toBeInstanceOf(PsaServiceError);
    await expect(verification).rejects.toMatchObject({
      code: "PSA_API_CONFIGURATION_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
