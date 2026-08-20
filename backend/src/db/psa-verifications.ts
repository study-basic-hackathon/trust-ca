import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PsaVerification } from "../services/psa.js";

/**
 * PSA照会の確定結果をDBへ永続化する(psa-api-mvp.md §7の残課題)。
 * cardsのlatest_psa_verification_id参照元・照会監査履歴として使う。
 * unavailable(一時障害)は履歴価値がないため保存対象にしない。
 */
export async function insertPsaVerification(
  pool: Pool,
  verification: PsaVerification,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO psa_verifications
       (id, cert_number, status, year, brand, category, subject, variety,
        grade, normalized_result, checked_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      verification.certNumber,
      verification.status,
      verification.card?.year ?? null,
      verification.card?.brand ?? null,
      verification.card?.category ?? null,
      verification.card?.subject ?? null,
      verification.card?.variety ?? null,
      verification.card?.cardGrade ?? null,
      verification.card ? JSON.stringify(verification.card) : null,
      verification.checkedAt,
      verification.expiresAt,
    ],
  );
  return id;
}
