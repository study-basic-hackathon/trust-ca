import { randomUUID } from "node:crypto";
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

export async function createSeller(
  pool: Pool,
  displayName: string,
): Promise<Seller> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = randomUUID();
    await client.query(`INSERT INTO users (id, display_name) VALUES ($1, $2)`, [
      id,
      displayName,
    ]);
    await client.query(
      `INSERT INTO seller_profiles (user_id, onboarding_status) VALUES ($1, 'pending_kyc')`,
      [id],
    );
    await client.query("COMMIT");
    const seller = await getSellerById(pool, id);
    if (!seller) {
      throw new Error("販売者の作成に失敗しました。");
    }
    return seller;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getSellerById(
  pool: Pool,
  id: string,
): Promise<Seller | null> {
  const result = await pool.query(`${SELECT_SELLER} WHERE u.id = $1`, [id]);
  return result.rows[0] ? toSeller(result.rows[0]) : null;
}
