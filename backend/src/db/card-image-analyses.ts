import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type CardImageAnalysisStatus =
  | "pending"
  | "processing"
  | "completed"
  | "in_review"
  | "failed";

export type AnalysisResult = {
  ocrText: string;
  matchedName: boolean;
  matchedCardNumber: boolean | null;
  cardLikeLabelDetected: boolean;
  labels: { description: string; score: number }[];
  objectBoundingBoxes: { name: string; score: number }[];
  failureReason: string | null;
};

export type CardImageAnalysisRecord = {
  id: string;
  cardId: string;
  sourceImageId: string;
  comparisonImageId: string | null;
  analysisKind: "ocr" | "label_detection" | "object_localization" | "image_comparison";
  provider: string;
  status: CardImageAnalysisStatus;
  score: number | null;
  normalizedResult: AnalysisResult | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminCardImageAnalysisRow = CardImageAnalysisRecord & {
  cardName: string;
  cardSeries: string | null;
  cardNumber: string | null;
  storageBucket: string;
  storageObject: string;
};

function toRecord(row: Record<string, unknown>): CardImageAnalysisRecord {
  return {
    id: String(row.id),
    cardId: String(row.card_id),
    sourceImageId: String(row.source_image_id),
    comparisonImageId: row.comparison_image_id ? String(row.comparison_image_id) : null,
    analysisKind: String(row.analysis_kind) as CardImageAnalysisRecord["analysisKind"],
    provider: String(row.provider),
    status: String(row.status) as CardImageAnalysisStatus,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    normalizedResult:
      row.normalized_result === null || row.normalized_result === undefined
        ? null
        : (row.normalized_result as AnalysisResult),
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export async function insertCardImageAnalysis(
  pool: Pool,
  input: {
    cardId: string;
    sourceImageId: string;
    status: CardImageAnalysisStatus;
    score: number | null;
    normalizedResult: AnalysisResult | null;
  },
): Promise<CardImageAnalysisRecord> {
  const result = await pool.query(
    `INSERT INTO card_image_analyses (
       id, card_id, source_image_id, analysis_kind, provider, status, score, normalized_result, completed_at
     ) VALUES ($1, $2, $3, 'ocr', 'google_vision', $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      randomUUID(),
      input.cardId,
      input.sourceImageId,
      input.status,
      input.score,
      input.normalizedResult ? JSON.stringify(input.normalizedResult) : null,
    ],
  );
  return toRecord(result.rows[0]);
}

export async function getCardImageAnalysisById(
  pool: Pool,
  analysisId: string,
): Promise<CardImageAnalysisRecord | null> {
  const result = await pool.query(
    `SELECT * FROM card_image_analyses WHERE id = $1`,
    [analysisId],
  );
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

export async function listCardImageAnalysesByCard(
  pool: Pool,
  cardId: string,
): Promise<CardImageAnalysisRecord[]> {
  const result = await pool.query(
    `SELECT * FROM card_image_analyses WHERE card_id = $1 ORDER BY created_at DESC`,
    [cardId],
  );
  return result.rows.map(toRecord);
}

export async function listCardImageAnalysesForAdmin(
  pool: Pool,
  filter: { status?: CardImageAnalysisStatus } = {},
): Promise<AdminCardImageAnalysisRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filter.status) {
    values.push(filter.status);
    conditions.push(`a.status = $${values.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT a.*, c.name AS card_name, c.series AS card_series, c.card_number AS card_number,
            i.storage_bucket, i.storage_object
       FROM card_image_analyses a
       JOIN cards c ON c.id = a.card_id
       JOIN card_images i ON i.id = a.source_image_id
       ${whereClause}
      ORDER BY a.created_at DESC`,
    values,
  );
  return result.rows.map((row) => ({
    ...toRecord(row),
    cardName: String(row.card_name),
    cardSeries: row.card_series ? String(row.card_series) : null,
    cardNumber: row.card_number ? String(row.card_number) : null,
    storageBucket: String(row.storage_bucket),
    storageObject: String(row.storage_object),
  }));
}
