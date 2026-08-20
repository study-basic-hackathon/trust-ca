import type { Pool } from "pg";

export type Seller = {
  id: string;
  displayName: string;
  status: string;
  onboardingStatus: string;
  createdAt: Date;
};

function toSeller(row: Record<string, unknown>): Seller {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at
      : new Date(String(row.created_at));
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    status: String(row.status),
    onboardingStatus: String(row.onboarding_status),
    createdAt,
  };
}

const SELECT_SELLER = `
  SELECT u.id, u.display_name, u.status, u.created_at, sp.onboarding_status
    FROM users u
    JOIN seller_profiles sp ON sp.user_id = u.id`;

export class SellerAlreadyRegisteredError extends Error {
  constructor() {
    super("この販売者はすでに登録されています。");
    this.name = "SellerAlreadyRegisteredError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("ユーザーが見つかりません。");
    this.name = "UserNotFoundError";
  }
}

/**
 * ログイン済みユーザーを販売者として登録する。
 * ウォレット認証で作成されたusersへseller_profilesを紐付け、表示名を設定する。
 */
export async function registerSellerForUser(
  pool: Pool,
  userId: string,
  displayName: string,
): Promise<Seller> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      `UPDATE users SET display_name = $2 WHERE id = $1 RETURNING id`,
      [userId, displayName],
    );
    if (userResult.rowCount === 0) {
      throw new UserNotFoundError();
    }
    const profileResult = await client.query(
      `INSERT INTO seller_profiles (user_id, onboarding_status)
       VALUES ($1, 'pending_kyc')
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id`,
      [userId],
    );
    if (profileResult.rowCount === 0) {
      throw new SellerAlreadyRegisteredError();
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const seller = await getSellerById(pool, userId);
  if (!seller) {
    throw new Error("販売者の登録に失敗しました。");
  }
  return seller;
}

export async function getSellerById(
  pool: Pool,
  id: string,
): Promise<Seller | null> {
  const result = await pool.query(`${SELECT_SELLER} WHERE u.id = $1`, [id]);
  return result.rows[0] ? toSeller(result.rows[0]) : null;
}
