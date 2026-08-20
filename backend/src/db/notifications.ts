import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type NotificationType =
  | "order_paid"
  | "order_shipped"
  | "order_completed"
  | "order_cancelled"
  | "order_disputed"
  | "dispute_resolved"
  | "kyc_decided"
  | "listing_reviewed";

export type NotificationRecord = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  orderId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  orderId?: string;
};

/**
 * 通知を追加する。業務transaction内から呼ぶ場合はclientを渡す。
 * 通知の失敗が業務を巻き戻さないよう、transaction外での利用時は
 * 呼び出し側でエラーを握りつぶしてよい(補助機能のため)。
 */
export async function insertNotification(
  executor: Pool | PoolClient,
  input: NotificationInput,
): Promise<void> {
  await executor.query(
    `INSERT INTO notifications (id, user_id, type, title, body, order_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      input.userId,
      input.type,
      input.title,
      input.body ?? null,
      input.orderId ?? null,
    ],
  );
}

export async function listNotificationsForUser(
  pool: Pool,
  userId: string,
  limit = 20,
): Promise<{ items: NotificationRecord[]; unreadCount: number }> {
  const [items, unread] = await Promise.all([
    pool.query(
      `SELECT id, type, title, body, order_id, read_at, created_at
         FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, limit],
    ),
    pool.query(
      `SELECT count(*)::int AS unread
         FROM notifications
        WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    ),
  ]);
  return {
    items: items.rows.map((row) => ({
      id: String(row.id),
      type: String(row.type) as NotificationType,
      title: String(row.title),
      body: row.body ? String(row.body) : null,
      orderId: row.order_id ? String(row.order_id) : null,
      readAt: row.read_at ? new Date(String(row.read_at)) : null,
      createdAt: new Date(String(row.created_at)),
    })),
    unreadCount: Number(unread.rows[0]?.unread ?? 0),
  };
}

export async function markAllNotificationsRead(
  pool: Pool,
  userId: string,
): Promise<void> {
  await pool.query(
    `UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
}
