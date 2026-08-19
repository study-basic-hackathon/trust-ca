import { describe, expect, it } from "vitest";
import { evaluateContentMatch } from "../src/services/card-image-analysis.js";

const CARD_LABEL = { description: "Trading card", score: 0.95 };
const NON_CARD_LABEL = { description: "Cat", score: 0.95 };

describe("evaluateContentMatch", () => {
  it("名前・型番・カード様ラベルがすべて揃えばcompletedにする", () => {
    const result = evaluateContentMatch({
      ocrText: "Charizard ex\nSV1a 006/070",
      labels: [CARD_LABEL],
      objectBoundingBoxes: [{ name: "Card", score: 0.9 }],
      declaredName: "Charizard ex",
      declaredCardNumber: "006/070",
    });

    expect(result.status).toBe("completed");
    expect(result.score).toBe(1);
    expect(result.normalizedResult).toMatchObject({
      matchedName: true,
      matchedCardNumber: true,
      cardLikeLabelDetected: true,
    });
  });

  it("型番が未申告(null)なら名前とラベルだけでcompletedにする", () => {
    const result = evaluateContentMatch({
      ocrText: "Charizard ex",
      labels: [CARD_LABEL],
      objectBoundingBoxes: [],
      declaredName: "Charizard ex",
      declaredCardNumber: null,
    });

    expect(result.status).toBe("completed");
    expect(result.normalizedResult.matchedCardNumber).toBeNull();
  });

  it("全角/半角・大文字小文字を正規化して突合する", () => {
    const result = evaluateContentMatch({
      ocrText: "ＣＨＡＲＩＺＡＲＤ　ＥＸ　ＳＶ１ａ　００６／０７０",
      labels: [CARD_LABEL],
      objectBoundingBoxes: [],
      declaredName: "Charizard EX",
      declaredCardNumber: "SV1a 006/070",
    });

    expect(result.status).toBe("completed");
  });

  it("名前がOCR結果に含まれなければin_review・score 0", () => {
    const result = evaluateContentMatch({
      ocrText: "Pikachu",
      labels: [CARD_LABEL],
      objectBoundingBoxes: [],
      declaredName: "Charizard ex",
      declaredCardNumber: null,
    });

    expect(result.status).toBe("in_review");
    expect(result.score).toBe(0);
    expect(result.normalizedResult.matchedName).toBe(false);
  });

  it("カード様ラベルが検出されなければin_review・score 0", () => {
    const result = evaluateContentMatch({
      ocrText: "Charizard ex",
      labels: [NON_CARD_LABEL],
      objectBoundingBoxes: [],
      declaredName: "Charizard ex",
      declaredCardNumber: null,
    });

    expect(result.status).toBe("in_review");
    expect(result.score).toBe(0);
    expect(result.normalizedResult.cardLikeLabelDetected).toBe(false);
  });

  it("名前とラベルは一致するが型番が不一致ならin_review・score 0.5", () => {
    const result = evaluateContentMatch({
      ocrText: "Charizard ex 001/070",
      labels: [CARD_LABEL],
      objectBoundingBoxes: [],
      declaredName: "Charizard ex",
      declaredCardNumber: "006/070",
    });

    expect(result.status).toBe("in_review");
    expect(result.score).toBe(0.5);
    expect(result.normalizedResult.matchedCardNumber).toBe(false);
  });

  it("ラベルscoreが閾値未満ならカード様ラベルとみなさない", () => {
    const result = evaluateContentMatch({
      ocrText: "Charizard ex",
      labels: [{ description: "Trading card", score: 0.1 }],
      objectBoundingBoxes: [],
      declaredName: "Charizard ex",
      declaredCardNumber: null,
    });

    expect(result.normalizedResult.cardLikeLabelDetected).toBe(false);
  });
});
