import type { Step } from "@/components/status-stepper";

const STATUS_LABELS: Record<string, string> = {
  not_started: "未開始",
  in_progress: "確認中",
  in_review: "審査中(運営確認)",
  approved: "承認済み",
  declined: "否認",
  abandoned: "中断",
  expired: "期限切れ",
};

export function kycStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * eKYC正規化ステータス(7種)から「登録→本人確認→審査→承認」の
 * 段階表示を導出する。poc/ekyc の flow 導出ロジックの意匠を踏襲。
 */
export function deriveKycSteps(status: string | null): Step[] {
  const steps: Step[] = [
    { key: "register", label: "販売者登録", state: "done" },
    { key: "kyc", label: "本人確認", state: "waiting" },
    { key: "review", label: "審査", state: "waiting" },
    { key: "approved", label: "承認", state: "waiting" },
  ];
  switch (status) {
    case null:
    case "not_started":
      steps[1].state = "active";
      break;
    case "in_progress":
      steps[1].state = "active";
      break;
    case "in_review":
      steps[1].state = "done";
      steps[2].state = "review";
      break;
    case "approved":
      steps[1].state = "done";
      steps[2].state = "done";
      steps[3].state = "done";
      break;
    case "declined":
      steps[1].state = "done";
      steps[2].state = "failed";
      steps[3].state = "failed";
      break;
    case "abandoned":
    case "expired":
      steps[1].state = "failed";
      break;
    default:
      // 未知の値は審査中として扱う(フェイルセーフ)
      steps[1].state = "done";
      steps[2].state = "review";
      break;
  }
  return steps;
}
