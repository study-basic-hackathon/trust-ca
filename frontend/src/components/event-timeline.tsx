import { cn } from "@/lib/utils";

export type TimelineEvent = {
  id: string | number;
  title: string;
  description?: string;
  occurredAt: string;
  /** 取得経路等の補足(例: 「取得元: Webhook(署名検証済み)」) */
  meta?: string;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/** 状態変化履歴の共通表示(poc/ekyc EventTimelineの意匠を踏襲)。新しい順に渡す。 */
export function EventTimeline({
  events,
  className,
}: {
  events: TimelineEvent[];
  className?: string;
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">まだ履歴がありません。</p>
    );
  }
  return (
    <ul className={cn("space-y-0", className)}>
      {events.map((event, index) => (
        <li
          key={event.id}
          className={cn(
            "relative border-l-2 border-border pb-5 pl-5",
            index === events.length - 1 && "border-l-transparent pb-0",
          )}
        >
          <span
            className="absolute -left-[7px] top-1 size-3 rounded-full border-2 border-card bg-primary"
            aria-hidden
          />
          <p className="text-xs text-muted-foreground">
            {formatDateTime(event.occurredAt)}
          </p>
          <p className="text-sm font-medium">{event.title}</p>
          {event.description && (
            <p className="text-sm text-muted-foreground">{event.description}</p>
          )}
          {event.meta && (
            <p className="mt-0.5 text-xs text-muted-foreground">{event.meta}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
