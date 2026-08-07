import type { FlowStepView } from "@/components/flowTypes";

const STEP_STATE_ICONS: Record<FlowStepView["state"], string> = {
  done: "✓",
  active: "●",
  review: "🔍",
  failed: "✕",
  waiting: "○",
};

export function FlowStepper({ steps }: { steps: FlowStepView[] }) {
  return (
    <ol className="stepper">
      {steps.map((step) => (
        <li key={step.key} className={`step step-${step.state}`}>
          <span className="step-icon" aria-hidden>
            {STEP_STATE_ICONS[step.state]}
          </span>
          <span className="step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
