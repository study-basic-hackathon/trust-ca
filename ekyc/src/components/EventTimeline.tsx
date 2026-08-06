import type { VerificationEventView } from "@/components/flowTypes";
import { STATUS_LABELS } from "@/components/flowTypes";

const EVENT_LABELS: Record<VerificationEventView["eventType"], string> = {
  session_created: "KYCセッション作成",
  status_changed: "ステータス変更",
  checks_updated: "チェック結果更新",
};

const SOURCE_LABELS: Record<string, string> = {
  created: "セッション作成",
  poll: "ポーリング (decision API)",
  webhook: "Webhook (署名検証済み)",
};

const CHECK_LABELS: Record<string, string> = {
  document: "書類",
  liveness: "ライブネス",
  faceMatch: "顔照合",
  ipAnalysis: "IP",
};

const CHECK_RESULT_SHORT: Record<string, string> = {
  passed: "✅",
  failed: "❌",
  in_review: "🔍",
  not_run: "—",
};

export function EventTimeline({ events }: { events: VerificationEventView[] }) {
  if (events.length === 0) {
    return <p className="muted">まだ履歴がありません。</p>;
  }

  return (
    <ul className="timeline">
      {[...events].reverse().map((event) => (
        <li key={event.id} className="timeline-item">
          <div className="timeline-time">{event.createdAt} UTC</div>
          <div className="timeline-body">
            <strong>{EVENT_LABELS[event.eventType]}</strong>
            {event.eventType === "status_changed" && (
              <span>
                {" "}
                : {STATUS_LABELS[event.fromStatus ?? ""] ?? event.fromStatus} →{" "}
                {STATUS_LABELS[event.toStatus] ?? event.toStatus}
              </span>
            )}
            {event.checks && (
              <div className="timeline-checks">
                {Object.entries(event.checks).map(([key, value]) => (
                  <span key={key} className="check-chip">
                    {CHECK_LABELS[key] ?? key}{" "}
                    {CHECK_RESULT_SHORT[value] ?? value}
                  </span>
                ))}
              </div>
            )}
            <div className="muted">
              取得元: {SOURCE_LABELS[event.source] ?? event.source}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
