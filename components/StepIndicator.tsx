interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

export default function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <nav aria-label="故事创作进度" className="mb-5 min-w-0 overflow-x-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 md:mb-7 md:p-3">
      <div className="flex min-w-max items-center px-1">
        {steps.map((step, index) => (
          <div key={index} className="flex shrink-0 items-center">
            <div className="flex shrink-0 items-center gap-2 md:gap-3">
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border font-mono text-xs font-bold ${
                  index + 1 <= currentStep
                    ? 'border-[var(--accent-green)]/50 bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                }`}
              >
                {index + 1}
              </div>
              <span className={`whitespace-nowrap text-[10px] font-mono md:text-xs ${
                index + 1 === currentStep
                  ? 'text-[var(--accent-green)]'
                  : index + 1 < currentStep
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)]'
              }`}>
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`mx-3 h-px w-5 shrink-0 lg:mx-5 lg:w-9 ${
                  index + 1 < currentStep ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-color)]'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
