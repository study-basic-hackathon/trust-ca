import { BadgeCheck, ScanSearch, ShieldCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrustSignal =
  | "seller_verified" // 本人確認済み
  | "psa_verified" // PSA登録情報確認済み
  | "image_analyzed" // 画像解析済み(内容整合)
  | "in_review" // 審査中
  | "needs_review"; // 要確認

const SIGNAL_DEFS: Record<
  TrustSignal,
  { label: string; className: string; Icon: typeof ShieldCheck }
> = {
  seller_verified: {
    label: "本人確認済み",
    className: "border-success/40 bg-success/10 text-success",
    Icon: ShieldCheck,
  },
  psa_verified: {
    label: "PSA登録情報確認済み",
    className: "border-gold/40 bg-gold/10 text-gold",
    Icon: BadgeCheck,
  },
  image_analyzed: {
    label: "画像解析済み",
    className: "border-primary/40 bg-primary/10 text-primary",
    Icon: ScanSearch,
  },
  in_review: {
    label: "審査中",
    className: "border-warning/40 bg-warning/10 text-warning",
    Icon: Clock,
  },
  needs_review: {
    label: "要確認",
    className: "border-warning/40 bg-warning/10 text-warning",
    Icon: Clock,
  },
};

/**
 * 信頼シグナルバッジ。文言は「確認できた事実」のみを表し、
 * 真贋保証と誤認される表現(鑑定済み・本物保証等)は使わない。
 */
export function TrustBadge({
  signal,
  className,
}: {
  signal: TrustSignal;
  className?: string;
}) {
  const def = SIGNAL_DEFS[signal];
  const Icon = def.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        def.className,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {def.label}
    </span>
  );
}
