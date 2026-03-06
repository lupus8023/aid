interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

export default function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="mb-4 md:mb-8 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-3 md:p-4">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={index} className="flex items-center flex-1">
            <div className="flex items-center gap-1 md:gap-3 flex-1">
              <div
                className={`w-6 h-6 md:w-8 md:h-8 rounded flex items-center justify-center font-mono text-xs md:text-sm font-bold transition-colors ${
                  index + 1 <= currentStep
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                }`}
              >
                {index + 1}
              </div>
              <span className={`text-[10px] md:text-xs font-mono ${
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
                className={`w-4 md:w-8 h-0.5 mx-1 md:mx-2 transition-colors ${
                  index + 1 < currentStep ? 'bg-[var(--accent-blue)]' : 'bg-[var(--border-color)]'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
