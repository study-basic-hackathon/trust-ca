import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Address, Hash } from "viem";
import type { WalletSession } from "../services/session-token.js";

export type PaymentIntentStatus =
  | "created"
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired";

export type PaymentIntentRecord = {
  id: string;
  orderId: string;
  status: PaymentIntentStatus;
  chainId: number;
  tokenAddress: Address;
  fromAddress: Address;
  toAddress: Address;
  amountAtomic: string;
  tokenDecimals: number;
  txHash: Hash | null;
  blockNumber: string | null;
  expiresAt: Date;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  lastErrorCode: string | null;
  created: boolean;
};

export type PaymentVerificationJob = {
  id: string;
  orderId: string;
  chainId: number;
  tokenAddress: Address;
  payerAddress: Address;
  payeeAddress: Address;
  amountAtomic: bigint;
  txHash: Hash;
  attemptCount: number;
  submittedAt: Date;
};

export class PaymentRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentRepositoryError";
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

function toRecord(
  row: Record<string, unknown>,
  created: boolean,
): PaymentIntentRecord {
  const toDate = (value: unknown): Date =>
    value instanceof Date ? value : new Date(String(value));
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    status: String(row.status) as PaymentIntentStatus,
    chainId: Number(row.chain_id),
    tokenAddress: String(row.token_address_normalized) as Address,
    fromAddress: String(row.from_address_normalized) as Address,
    toAddress: String(row.to_address_normalized) as Address,
    amountAtomic: String(row.amount_atomic),
    tokenDecimals: Number(row.token_decimals),
    txHash: row.tx_hash ? (String(row.tx_hash) as Hash) : null,
    blockNumber: row.block_number ? String(row.block_number) : null,
    expiresAt: toDate(row.expires_at),
    submittedAt: row.submitted_at ? toDate(row.submitted_at) : null,
    confirmedAt: row.confirmed_at ? toDate(row.confirmed_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    created,
  };
}

export async function createPaymentIntent(
  pool: Pool,
  input: {
    orderId: string;
    session: WalletSession;
    chainId: number;
    tokenAddress: Address;
    tokenDecimals: number;
    lifetimeSeconds: number;
  },
): Promise<PaymentIntentRecord> {
  return withTransaction(pool, async (client) => {
    const orderResult = await client.query(
      `SELECT o.*, l.status AS listing_status
         FROM orders o
         JOIN listings l ON l.id = o.listing_id
        WHERE o.id = $1
        FOR UPDATE OF o, l`,
      [input.orderId],
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw new PaymentRepositoryError("ORDER_NOT_FOUND", "注文が見つかりません。");
    }
    if (order.buyer_id !== input.session.userId) {
      throw new PaymentRepositoryError(
        "PAYMENT_FORBIDDEN",
        "この注文の支払いを開始する権限がありません。",
      );
    }
    if (input.session.chainId !== input.chainId) {
      throw new PaymentRepositoryError(
        "PAYMENT_SESSION_CHAIN_MISMATCH",
        "認証済みwalletのchainが決済chainと一致しません。",
      );
    }
    if (order.currency !== "JPY") {
      throw new PaymentRepositoryError(
        "PAYMENT_CURRENCY_NOT_SUPPORTED",
        "JPYC決済ではJPY建ての注文だけを取り扱います。",
      );
    }
    const priceMinor = BigInt(String(order.price_minor));
    const amountAtomic = priceMinor * 10n ** BigInt(input.tokenDecimals);
    if (amountAtomic > 2n ** 256n - 1n) {
      throw new PaymentRepositoryError(
        "PAYMENT_AMOUNT_OUT_OF_RANGE",
        "支払額がERC-20で取り扱える範囲を超えています。",
      );
    }

    const existingResult = await client.query(
      `SELECT *
         FROM payment_intents
        WHERE order_id = $1
          AND status IN ('created', 'submitted', 'confirmed')
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.orderId],
    );
    let existing = existingResult.rows[0];
    if (
      existing?.status === "created" &&
      (existing.expires_at instanceof Date
        ? existing.expires_at
        : new Date(String(existing.expires_at))) <= new Date()
    ) {
      await client.query(
        `UPDATE payment_intents SET status = 'expired' WHERE id = $1`,
        [existing.id],
      );
      existing = null;
    }
    if (existing) {
      const termsMatch =
        Number(existing.chain_id) === input.chainId &&
        existing.token_address_normalized === input.tokenAddress.toLowerCase() &&
        existing.from_address_normalized === input.session.walletAddress &&
        Number(existing.token_decimals) === input.tokenDecimals &&
        BigInt(existing.amount_atomic) === amountAtomic;
      if (!termsMatch) {
        throw new PaymentRepositoryError(
          "PAYMENT_INTENT_CONFLICT",
          "既存のpayment intentが現在のwalletまたはtoken設定と一致しません。",
        );
      }
      return toRecord(existing, false);
    }

    if (order.status !== "pending_payment" || order.listing_status !== "reserved") {
      throw new PaymentRepositoryError(
        "ORDER_NOT_PAYABLE",
        "この注文は現在支払いを開始できる状態ではありません。",
      );
    }
    const payerResult = await client.query(
      `SELECT id
         FROM wallet_accounts
        WHERE user_id = $1
          AND chain_id = $2
          AND address_normalized = $3
          AND disabled_at IS NULL
        FOR UPDATE`,
      [input.session.userId, input.chainId, input.session.walletAddress],
    );
    if (payerResult.rowCount !== 1) {
      throw new PaymentRepositoryError(
        "PAYER_WALLET_NOT_FOUND",
        "認証済みの支払元walletを確認できません。",
      );
    }

    const payeeResult = await client.query(
      `SELECT id, address_normalized
         FROM wallet_accounts
        WHERE user_id = $1
          AND chain_id = $2
          AND disabled_at IS NULL
        ORDER BY created_at, id
        FOR UPDATE`,
      [order.seller_id, input.chainId],
    );
    if (payeeResult.rowCount !== 1) {
      throw new PaymentRepositoryError(
        "PAYEE_WALLET_UNAVAILABLE",
        "販売者の受取walletを一意に決定できません。",
      );
    }
    const payee = payeeResult.rows[0];
    if (payee.address_normalized === input.session.walletAddress) {
      throw new PaymentRepositoryError(
        "PAYMENT_PARTIES_INVALID",
        "支払元と受取先に同じwalletは指定できません。",
      );
    }

    const result = await client.query(
      `INSERT INTO payment_intents (
         id, order_id, payer_wallet_id, payee_wallet_id, chain_id,
         token_address_normalized, from_address_normalized,
         to_address_normalized, amount_atomic, token_decimals, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         CURRENT_TIMESTAMP + make_interval(secs => $11::double precision)
       )
       RETURNING *`,
      [
        randomUUID(),
        input.orderId,
        payerResult.rows[0].id,
        payee.id,
        input.chainId,
        input.tokenAddress.toLowerCase(),
        input.session.walletAddress,
        payee.address_normalized,
        amountAtomic.toString(),
        input.tokenDecimals,
        input.lifetimeSeconds,
      ],
    );
    return toRecord(result.rows[0], true);
  });
}

export async function submitPaymentTransaction(
  pool: Pool,
  input: { paymentIntentId: string; session: WalletSession; txHash: Hash },
): Promise<PaymentIntentRecord> {
  const outcome = await withTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT p.*, o.buyer_id, o.status AS order_status
         FROM payment_intents p
         JOIN orders o ON o.id = p.order_id
        WHERE p.id = $1
        FOR UPDATE OF p, o`,
      [input.paymentIntentId],
    );
    const payment = result.rows[0];
    if (!payment) {
      throw new PaymentRepositoryError(
        "PAYMENT_INTENT_NOT_FOUND",
        "payment intentが見つかりません。",
      );
    }
    if (
      payment.buyer_id !== input.session.userId ||
      payment.from_address_normalized !== input.session.walletAddress ||
      Number(payment.chain_id) !== input.session.chainId
    ) {
      throw new PaymentRepositoryError(
        "PAYMENT_FORBIDDEN",
        "このpayment intentを更新する権限がありません。",
      );
    }
    const txHash = input.txHash.toLowerCase();
    if (payment.status === "submitted" || payment.status === "confirmed") {
      if (payment.tx_hash !== txHash) {
        throw new PaymentRepositoryError(
          "PAYMENT_TRANSACTION_CONFLICT",
          "すでに別のtransaction hashが登録されています。",
        );
      }
      return toRecord(payment, false);
    }
    if (payment.status !== "created") {
      throw new PaymentRepositoryError(
        "PAYMENT_INTENT_NOT_SUBMITTABLE",
        "このpayment intentにはtransactionを登録できません。",
      );
    }
    if (new Date(payment.expires_at) <= new Date()) {
      await client.query(
        `UPDATE payment_intents SET status = 'expired' WHERE id = $1`,
        [input.paymentIntentId],
      );
      return new PaymentRepositoryError(
        "PAYMENT_INTENT_EXPIRED",
        "payment intentの有効期限が切れています。",
      );
    }
    if (payment.order_status !== "pending_payment") {
      throw new PaymentRepositoryError(
        "ORDER_NOT_PAYABLE",
        "注文が支払い可能な状態ではありません。",
      );
    }

    try {
      const updated = await client.query(
        `UPDATE payment_intents
            SET status = 'submitted',
                tx_hash = $2,
                submitted_at = CURRENT_TIMESTAMP,
                next_verification_at = CURRENT_TIMESTAMP,
                last_error_code = NULL,
                last_error_message = NULL
          WHERE id = $1
        RETURNING *`,
        [input.paymentIntentId, txHash],
      );
      await client.query(
        `UPDATE orders SET status = 'payment_submitted' WHERE id = $1`,
        [payment.order_id],
      );
      return toRecord(updated.rows[0], false);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new PaymentRepositoryError(
          "PAYMENT_TRANSACTION_ALREADY_USED",
          "このtransaction hashは別のpayment intentで使用済みです。",
        );
      }
      throw error;
    }
  });
  if (outcome instanceof PaymentRepositoryError) throw outcome;
  return outcome;
}

export async function getPaymentIntentForSession(
  pool: Pool,
  input: { paymentIntentId: string; session: WalletSession },
): Promise<PaymentIntentRecord | null> {
  const result = await pool.query(
    `SELECT p.*
       FROM payment_intents p
       JOIN orders o ON o.id = p.order_id
      WHERE p.id = $1
        AND $2 IN (o.buyer_id, o.seller_id)`,
    [input.paymentIntentId, input.session.userId],
  );
  return result.rows[0] ? toRecord(result.rows[0], false) : null;
}

export async function claimPaymentVerificationJobs(
  pool: Pool,
  input: { workerId: string; batchSize: number; lockTimeoutSeconds: number },
): Promise<PaymentVerificationJob[]> {
  const result = await pool.query(
    `WITH candidates AS MATERIALIZED (
       SELECT id
         FROM payment_intents
        WHERE status = 'submitted'
          AND next_verification_at <= CURRENT_TIMESTAMP
          AND (
            locked_at IS NULL
            OR locked_at < CURRENT_TIMESTAMP - make_interval(secs => $3::double precision)
          )
        ORDER BY next_verification_at, submitted_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     ), claimed AS (
       UPDATE payment_intents p
          SET verification_attempt_count = verification_attempt_count + 1,
              locked_at = CURRENT_TIMESTAMP,
              locked_by = $1,
              last_error_code = NULL,
              last_error_message = NULL
         FROM candidates c
        WHERE p.id = c.id
       RETURNING p.*
     )
     SELECT * FROM claimed ORDER BY submitted_at, id`,
    [input.workerId, input.batchSize, input.lockTimeoutSeconds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    chainId: Number(row.chain_id),
    tokenAddress: row.token_address_normalized,
    payerAddress: row.from_address_normalized,
    payeeAddress: row.to_address_normalized,
    amountAtomic: BigInt(row.amount_atomic),
    txHash: row.tx_hash,
    attemptCount: Number(row.verification_attempt_count),
    submittedAt:
      row.submitted_at instanceof Date
        ? row.submitted_at
        : new Date(String(row.submitted_at)),
  }));
}

export async function markPaymentConfirmed(
  pool: Pool,
  input: {
    paymentIntentId: string;
    workerId: string;
    blockNumber: bigint;
  },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const paymentResult = await client.query(
      `UPDATE payment_intents
          SET status = 'confirmed',
              block_number = $3,
              confirmed_at = CURRENT_TIMESTAMP,
              locked_at = NULL,
              locked_by = NULL,
              last_error_code = NULL,
              last_error_message = NULL
        WHERE id = $1
          AND status = 'submitted'
          AND locked_by = $2
      RETURNING order_id`,
      [input.paymentIntentId, input.workerId, input.blockNumber.toString()],
    );
    if (paymentResult.rowCount !== 1) {
      throw new Error("payment検証jobのlockを失いました。");
    }
    const orderResult = await client.query(
      `UPDATE orders
          SET status = 'paid', paid_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'payment_submitted'
      RETURNING listing_id`,
      [paymentResult.rows[0].order_id],
    );
    if (orderResult.rowCount !== 1) {
      throw new Error("注文をpaidへ更新できませんでした。");
    }
    const listingResult = await client.query(
      `UPDATE listings
          SET status = 'sold', closed_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'reserved'`,
      [orderResult.rows[0].listing_id],
    );
    if (listingResult.rowCount !== 1) {
      throw new Error("出品をsoldへ更新できませんでした。");
    }
  });
}

export async function markPaymentVerificationFailure(
  pool: Pool,
  input: {
    paymentIntentId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    terminal: boolean;
    retryDelayMs: number;
  },
): Promise<"submitted" | "failed"> {
  return withTransaction(pool, async (client) => {
    const status = input.terminal ? "failed" : "submitted";
    const result = await client.query(
      `UPDATE payment_intents
          SET status = $3,
              next_verification_at = CURRENT_TIMESTAMP
                + ($4::double precision * interval '1 millisecond'),
              locked_at = NULL,
              locked_by = NULL,
              last_error_code = $5,
              last_error_message = $6
        WHERE id = $1
          AND status = 'submitted'
          AND locked_by = $2
      RETURNING order_id`,
      [
        input.paymentIntentId,
        input.workerId,
        status,
        input.retryDelayMs,
        input.errorCode.slice(0, 64),
        input.errorMessage.slice(0, 1_000),
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("payment検証jobのlockを失いました。");
    }
    if (input.terminal) {
      await client.query(
        `UPDATE orders
            SET status = 'pending_payment'
          WHERE id = $1 AND status = 'payment_submitted'`,
        [result.rows[0].order_id],
      );
    }
    return status;
  });
}
