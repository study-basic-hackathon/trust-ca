import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type CardInput = {
  ownerId: string;
  name: string;
  series: string | null;
  cardNumber: string | null;
  grade: string | null;
  psaCertNumber: string | null;
};

export type CardDetail = {
  id: string;
  currentOwnerId: string;
  name: string;
  series: string | null;
  cardNumber: string | null;
  grade: string | null;
  psaCertNumber: string | null;
  status: string;
  psaVerificationStatus: string | null;
  createdAt: Date;
};

export class CertNumberAlreadyUsedError extends Error {
  constructor() {
    super(
      "このPSA証明書番号は既に別のカードで登録されています。番号をご確認ください。",
    );
    this.name = "CertNumberAlreadyUsedError";
  }
}

function toCardDetail(row: Record<string, unknown>): CardDetail {
  return {
    id: String(row.id),
    currentOwnerId: String(row.current_owner_id),
    name: String(row.name),
    series: row.series ? String(row.series) : null,
    cardNumber: row.card_number ? String(row.card_number) : null,
    grade: row.grade ? String(row.grade) : null,
    psaCertNumber: row.psa_cert_number ? String(row.psa_cert_number) : null,
    status: String(row.status),
    psaVerificationStatus: row.psa_verification_status
      ? String(row.psa_verification_status)
      : null,
    createdAt: new Date(String(row.created_at)),
  };
}

const SELECT_CARD_DETAIL = `
  SELECT c.id, c.current_owner_id, c.name, c.series, c.card_number, c.grade,
         c.psa_cert_number, c.status, c.created_at,
         pv.status AS psa_verification_status
    FROM cards c
    LEFT JOIN psa_verifications pv ON pv.id = c.latest_psa_verification_id`;

/**
 * 出品ウィザードのStep1でdraftカードを作成する。
 * PSA証明書番号は全カードで一意(cards_psa_cert_number_uq)であり、
 * 同一番号の使い回しはDB制約で拒否される。
 */
export async function createCard(
  pool: Pool,
  input: CardInput,
): Promise<CardDetail> {
  const id = randomUUID();
  try {
    await pool.query(
      `INSERT INTO cards
         (id, current_owner_id, name, series, card_number, grade, psa_cert_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.ownerId,
        input.name,
        input.series,
        input.cardNumber,
        input.grade,
        input.psaCertNumber,
      ],
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      throw new CertNumberAlreadyUsedError();
    }
    throw error;
  }
  const card = await getCardDetailById(pool, id);
  if (!card) {
    throw new Error("カードの作成に失敗しました。");
  }
  return card;
}

export async function getCardDetailById(
  pool: Pool,
  cardId: string,
): Promise<CardDetail | null> {
  const result = await pool.query(`${SELECT_CARD_DETAIL} WHERE c.id = $1`, [
    cardId,
  ]);
  return result.rows[0] ? toCardDetail(result.rows[0]) : null;
}

/**
 * カードへ最新のPSA照会結果を紐付ける。同一Cert番号の照会結果のみ
 * 参照できる(cards_latest_psa_matches_cert_fk)。
 */
export async function attachLatestPsaVerification(
  pool: Pool,
  input: { cardId: string; ownerId: string; psaVerificationId: string },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE cards
        SET latest_psa_verification_id = $3
      WHERE id = $1 AND current_owner_id = $2`,
    [input.cardId, input.ownerId, input.psaVerificationId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * まだ出品(listings)に至っていない、出品ウィザード途中のカード一覧。
 * 一覧・再開導線(mypage/listings「作成中」)用。archived(破棄済み)は除外する。
 */
export async function listCardDraftsByOwner(
  pool: Pool,
  ownerId: string,
): Promise<CardDetail[]> {
  const result = await pool.query(
    `${SELECT_CARD_DETAIL}
      WHERE c.current_owner_id = $1
        AND c.status <> 'archived'
        AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.card_id = c.id)
      ORDER BY c.created_at DESC`,
    [ownerId],
  );
  return result.rows.map(toCardDetail);
}

/**
 * 出品ウィザードを破棄する(cards.status='archived')。物理削除はしない
 * (アップロード済み画像・所持確認記録の追跡可能性を保つため)。
 * 既に出品(listings)が存在するカードは破棄できない。
 * psa_cert_numberはcards_psa_cert_number_uq(全カード一意)の対象のため、
 * 破棄時にクリアして同じ証明書番号での再登録(訂正)を可能にする。
 */
export async function discardCard(
  pool: Pool,
  input: { cardId: string; ownerId: string },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE cards
        SET status = 'archived',
            psa_cert_number = NULL,
            latest_psa_verification_id = NULL
      WHERE id = $1
        AND current_owner_id = $2
        AND status <> 'archived'
        AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.card_id = cards.id)`,
    [input.cardId, input.ownerId],
  );
  return (result.rowCount ?? 0) > 0;
}
