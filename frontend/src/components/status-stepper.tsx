import { Check, CircleDashed, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "active" | "review" | "failed" | "waiting";

export type Step = {
  key: string;
  label: string;
  state: StepState;
};

const STATE_STYLES: Record<StepState, string> = {
  done: "border-success/50 bg-success/10 text-success",
  active: "border-primary/50 bg-primary/10 text-primary animate-pulse",
  review: "border-warning/50 bg-warning/10 text-warning",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  waiting: "border-border text-muted-foreground",
};

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return <Check className="size-3.5" aria-hidden />;
    case "failed":
      return <X className="size-3.5" aria-hidden />;
    case "review":
      return <Search className="size-3.5" aria-hidden />;
    default:
      return <CircleDashed className="size-3.5" aria-hidden />;
  }
}

/** eKYC・取引などの段階進行の共通表示(poc/ekyc FlowStepperの意匠を踏襲)。 */
export function StatusStepper({
  steps,
  className,
}: {
  steps: Step[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {steps.map((step, index) => (
        <li key={step.key} className="flex items-center gap-1.5">
          {index > 0 && (
            <span className="text-muted-foreground/50" aria-hidden>
              →
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              STATE_STYLES[step.state],
            )}
          >
            <StepIcon state={step.state} />
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
