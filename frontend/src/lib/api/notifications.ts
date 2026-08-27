import { api } from "@/lib/api";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  orderId: string | null;
  isRead: boolean;
  createdAt: string;
};

export function fetchNotifications(
  token: string,
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  return api("/api/v1/notifications", {}, token);
}

export function markAllNotificationsRead(
  token: string,
): Promise<{ read: boolean }> {
  return api("/api/v1/notifications/read-all", { method: "POST" }, token);
}
