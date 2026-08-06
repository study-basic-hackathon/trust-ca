export type FlowStepView = {
  key: string;
  label: string;
  state: "done" | "active" | "review" | "failed" | "waiting";
};

export type VerificationEventView = {
  id: number;
  eventType: "session_created" | "status_changed" | "checks_updated";
  fromStatus: string | null;
  toStatus: string;
  checks: Record<string, string> | null;
  source: string;
  createdAt: string;
};

export const STATUS_LABELS: Record<string, string> = {
  not_started: "未開始",
  in_progress: "確認中",
  in_review: "審査中(人力確認)",
  approved: "本人確認済み",
  declined: "否認",
  abandoned: "中断",
  expired: "期限切れ",
};
