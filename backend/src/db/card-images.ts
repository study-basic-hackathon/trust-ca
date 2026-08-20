import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type CardImageKind =
  | "front"
  | "back"
  | "label"
  | "corner_top_left"
  | "corner_top_right"
  | "corner_bottom_left"
  | "corner_bottom_right"
  | "possession";

export type CardImageRecord = {
  id: string;
  cardId: string;
  uploadedByUserId: string;
  imageKind: CardImageKind;
  storageBucket: string;
  storageObject: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  captureNonce: string | null;
  retentionUntil: Date | null;
  createdAt: Date;
};

export type CardSummary = {
  id: string;
  currentOwnerId: string;
  name: string;
  series: string | null;
  cardNumber: string | null;
};

export class CardImageConflictError extends Error {
  constructor() {
    super("同じCloud Storage objectが既に別の画像として登録されています。");
    this.name = "CardImageConflictError";
  }
}

function toRecord(row: Record<string, unknown>): CardImageRecord {
  return {
    id: String(row.id),
    cardId: String(row.card_id),
    uploadedByUserId: String(row.uploaded_by_user_id),
    imageKind: String(row.image_kind) as CardImageKind,
    storageBucket: String(row.storage_bucket),
    storageObject: String(row.storage_object),
    contentType: String(row.content_type),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    captureNonce: row.capture_nonce ? String(row.capture_nonce) : null,
    retentionUntil: row.retention_until ? new Date(String(row.retention_until)) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

export async function getCardById(
  pool: Pool,
  cardId: string,
): Promise<CardSummary | null> {
  const result = await pool.query(
    `SELECT id, current_owner_id, name, series, card_number
       FROM cards
      WHERE id = $1`,
    [cardId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    currentOwnerId: String(row.current_owner_id),
    name: String(row.name),
    series: row.series ? String(row.series) : null,
    cardNumber: row.card_number ? String(row.card_number) : null,
  };
}

export async function insertCardImage(
  pool: Pool,
  input: {
    cardId: string;
    uploadedByUserId: string;
    imageKind: CardImageKind;
    storageBucket: string;
    storageObject: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    captureNonce?: string | null;
  },
): Promise<CardImageRecord> {
  try {
    const result = await pool.query(
      `INSERT INTO card_images (
         id, card_id, uploaded_by_user_id, image_kind,
         storage_bucket, storage_object, content_type, byte_size, sha256,
         capture_nonce
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        randomUUID(),
        input.cardId,
        input.uploadedByUserId,
        input.imageKind,
        input.storageBucket,
        input.storageObject,
        input.contentType,
        input.byteSize,
        input.sha256,
        input.captureNonce ?? null,
      ],
    );
    return toRecord(result.rows[0]);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new CardImageConflictError();
    }
    throw error;
  }
}

export async function getCardImageById(
  pool: Pool,
  imageId: string,
): Promise<CardImageRecord | null> {
  const result = await pool.query(`SELECT * FROM card_images WHERE id = $1`, [
    imageId,
  ]);
  const row = result.rows[0];
  return row ? toRecord(row) : null;
}

export async function listCardImagesByCard(
  pool: Pool,
  cardId: string,
): Promise<CardImageRecord[]> {
  const result = await pool.query(
    `SELECT * FROM card_images WHERE card_id = $1 ORDER BY created_at DESC`,
    [cardId],
  );
  return result.rows.map(toRecord);
}
