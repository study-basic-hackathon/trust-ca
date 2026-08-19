import type { AnalysisResult } from "../db/card-image-analyses.js";
import type { VisionLabel, VisionObjectBoundingBox } from "./vision.js";

const CARD_LABEL_ALLOWLIST = new Set([
  "card",
  "trading card",
  "playing card",
  "collectable card game",
  "games",
  "toy",
  "paper product",
  "paper",
]);
const LABEL_SCORE_THRESHOLD = 0.5;

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function isCardLikeLabel(labels: VisionLabel[]): boolean {
  return labels.some(
    (label) =>
      label.score >= LABEL_SCORE_THRESHOLD &&
      CARD_LABEL_ALLOWLIST.has(label.description.toLowerCase().trim()),
  );
}

export type ContentMatchEvaluation = {
  status: "completed" | "in_review";
  score: number;
  normalizedResult: AnalysisResult;
};

/**
 * OCR全文と出品時申告内容(cards.name/cards.card_number)を突合する。
 * 保守的な包含チェックのみを行い、あいまい一致は行わない
 * (data-model.md「判定ロジックとstatusの対応」参照)。
 */
export function evaluateContentMatch(params: {
  ocrText: string;
  labels: VisionLabel[];
  objectBoundingBoxes: VisionObjectBoundingBox[];
  declaredName: string;
  declaredCardNumber: string | null;
}): ContentMatchEvaluation {
  const normalizedOcrText = normalize(params.ocrText);
  const matchedName = normalizedOcrText.includes(normalize(params.declaredName));
  const matchedCardNumber =
    params.declaredCardNumber === null
      ? null
      : normalizedOcrText.includes(normalize(params.declaredCardNumber));
  const cardLikeLabelDetected = isCardLikeLabel(params.labels);

  const normalizedResult: AnalysisResult = {
    ocrText: params.ocrText,
    matchedName,
    matchedCardNumber,
    cardLikeLabelDetected,
    labels: params.labels,
    objectBoundingBoxes: params.objectBoundingBoxes,
    failureReason: null,
  };

  if (!matchedName || !cardLikeLabelDetected) {
    return { status: "in_review", score: 0, normalizedResult };
  }
  if (matchedCardNumber === false) {
    return { status: "in_review", score: 0.5, normalizedResult };
  }
  return { status: "completed", score: 1, normalizedResult };
}
