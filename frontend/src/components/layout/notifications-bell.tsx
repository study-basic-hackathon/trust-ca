"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  fetchNotifications,
  markAllNotificationsRead,
} from "@/lib/api/notifications";

const NOTIFICATIONS_POLL_INTERVAL_MS = 30_000;

/** ヘッダーの通知欄(screen-design.md §6.6)。30秒ごとに未読数を更新する。 */
export function NotificationsBell() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const notificationsQuery = useQuery({
    queryKey: ["notifications", session?.token],
    queryFn: () => fetchNotifications(session!.token),
    enabled: Boolean(session),
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
  });

  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(session!.token),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (!session) return null;
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const items = notificationsQuery.data?.items ?? [];

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`通知${unreadCount > 0 ? `(未読${unreadCount}件)` : ""}`}
        onClick={() => {
          setIsOpen((open) => !open);
          if (!isOpen && unreadCount > 0) {
            readAllMutation.mutate();
          }
        }}
      >
        <Bell className="size-5" aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="通知を閉じる"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border bg-card shadow-lg">
            <p className="border-b px-4 py-2 text-sm font-semibold">通知</p>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  通知はありません
                </p>
              ) : (
                items.map((item) => {
                  const content = (
                    <div
                      className={`border-b px-4 py-3 last:border-b-0 ${item.isRead ? "" : "bg-accent/50"}`}
                    >
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.body && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.body}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString("ja-JP")}
                      </p>
                    </div>
                  );
                  return item.orderId ? (
                    <Link
                      key={item.id}
                      href={`/orders/${item.orderId}`}
                      onClick={() => setIsOpen(false)}
                      className="block hover:bg-accent"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={item.id}>{content}</div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
