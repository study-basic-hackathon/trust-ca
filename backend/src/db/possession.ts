import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";

const CODE_TTL_MINUTES = 15;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字を除外

export type PossessionChallenge = {
  id: string;
  cardId: string;
  code: string;
  expiresAt: Date;
};

function generateCode(): string {
  const bytes = randomBytes(4);
  let body = "";
  for (const byte of bytes) {
    body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return `PKM-${body}`;
}

/** 出品ウィザードStep2.5用のワンタイム確認コードを発行する。 */
export async function createPossessionChallenge(
  pool: Pool,
  cardId: string,
): Promise<PossessionChallenge> {
  const id = randomUUID();
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  await pool.query(
    `INSERT INTO possession_challenges (id, card_id, code, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, cardId, code, expiresAt],
  );
  return { id, cardId, code, expiresAt };
}

/**
 * 所持証明画像の登録時にコードを消費する。
 * 有効期限内・未使用・対象カードのコードのみ受理する(1 statementで原子的に)。
 */
export async function consumePossessionChallenge(
  pool: Pool,
  input: { cardId: string; code: string },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE possession_challenges
        SET used_at = CURRENT_TIMESTAMP
      WHERE card_id = $1
        AND code = $2
        AND used_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP`,
    [input.cardId, input.code],
  );
  return (result.rowCount ?? 0) > 0;
}

/** カードに有効な所持証明画像が存在するか(出品作成時の必須チェック)。 */
export async function hasPossessionProof(
  pool: Pool,
  cardId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM card_images
      WHERE card_id = $1
        AND image_kind = 'possession'
        AND capture_nonce IS NOT NULL
      LIMIT 1`,
    [cardId],
  );
  return (result.rowCount ?? 0) > 0;
}
