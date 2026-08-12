import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type WalletChallengeRecord = {
  id: string;
  chainId: number;
  address: `0x${string}`;
  nonceSha256: string;
  domain: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type VerifiedWallet = {
  userId: string;
  walletId: string;
  address: `0x${string}`;
  chainId: number;
};

export class ChallengeRateLimitError extends Error {
  constructor() {
    super("署名リクエストが多すぎます。1分後に再試行してください。");
    this.name = "ChallengeRateLimitError";
  }
}

export class ChallengeUnavailableError extends Error {
  constructor() {
    super("署名チャレンジは使用済み、または期限切れです。");
    this.name = "ChallengeUnavailableError";
  }
}

async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function toChallenge(row: Record<string, unknown>): WalletChallengeRecord {
  const expiresAt =
    row.expires_at instanceof Date
      ? row.expires_at
      : new Date(String(row.expires_at));
  const usedAt = row.used_at
    ? row.used_at instanceof Date
      ? row.used_at
      : new Date(String(row.used_at))
    : null;
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at
      : new Date(String(row.created_at));
  return {
    id: String(row.id),
    chainId: Number(row.chain_id),
    address: String(row.address_normalized) as `0x${string}`,
    nonceSha256: String(row.nonce_sha256),
    domain: String(row.domain),
    expiresAt,
    usedAt,
    createdAt,
  };
}

export async function createWalletChallenge(
  pool: Pool,
  input: {
    id: string;
    chainId: number;
    address: `0x${string}`;
    nonceSha256: string;
    domain: string;
    expiresAt: Date;
  },
): Promise<WalletChallengeRecord> {
  return withTransaction(pool, async (client) => {
    const lockKey = `wallet-challenge:${input.chainId}:${input.address}`;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      lockKey,
    ]);
    const recent = await client.query(
      `SELECT count(*)::integer AS count
         FROM wallet_auth_challenges
        WHERE chain_id = $1
          AND address_normalized = $2
          AND created_at > CURRENT_TIMESTAMP - interval '1 minute'`,
      [input.chainId, input.address],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= 5) {
      throw new ChallengeRateLimitError();
    }

    const result = await client.query(
      `INSERT INTO wallet_auth_challenges (
         id, chain_id, address_normalized, nonce_sha256, domain, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.id,
        input.chainId,
        input.address,
        input.nonceSha256,
        input.domain,
        input.expiresAt,
      ],
    );
    return toChallenge(result.rows[0]);
  });
}

export async function getWalletChallenge(
  pool: Pool,
  id: string,
): Promise<WalletChallengeRecord | null> {
  const result = await pool.query(
    `SELECT * FROM wallet_auth_challenges WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? toChallenge(result.rows[0]) : null;
}

export async function consumeWalletChallenge(
  pool: Pool,
  input: {
    challengeId: string;
    chainId: number;
    address: `0x${string}`;
  },
): Promise<VerifiedWallet> {
  return withTransaction(pool, async (client) => {
    const lockKey = `wallet-account:${input.chainId}:${input.address}`;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      lockKey,
    ]);
    const consumed = await client.query(
      `UPDATE wallet_auth_challenges
          SET used_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND chain_id = $2
          AND address_normalized = $3
          AND used_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
      RETURNING *`,
      [input.challengeId, input.chainId, input.address],
    );
    if (consumed.rowCount !== 1) throw new ChallengeUnavailableError();

    const existing = await client.query(
      `SELECT id, user_id, disabled_at
         FROM wallet_accounts
        WHERE chain_id = $1 AND address_normalized = $2
        FOR UPDATE`,
      [input.chainId, input.address],
    );

    let userId: string;
    let walletId: string;
    if (existing.rows[0]) {
      if (existing.rows[0].disabled_at) {
        throw new Error("無効化されたウォレットは使用できません。");
      }
      userId = existing.rows[0].user_id;
      walletId = existing.rows[0].id;
    } else {
      userId = randomUUID();
      walletId = randomUUID();
      await client.query(
        `INSERT INTO users (id, display_name) VALUES ($1, 'ウォレットユーザー')`,
        [userId],
      );
      await client.query(
        `INSERT INTO wallet_accounts (
           id, user_id, provider, chain_id, address_normalized, verified_at
         ) VALUES ($1, $2, 'web3auth', $3, $4, CURRENT_TIMESTAMP)`,
        [walletId, userId, input.chainId, input.address],
      );
    }

    await client.query(
      `UPDATE wallet_auth_challenges SET user_id = $2 WHERE id = $1`,
      [input.challengeId, userId],
    );
    return {
      userId,
      walletId,
      address: input.address,
      chainId: input.chainId,
    };
  });
}
