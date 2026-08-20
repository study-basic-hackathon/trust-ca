import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** 空一覧の共通表示。次の行動への導線を必ず添える。 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <Icon className="size-10 text-muted-foreground/60" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
