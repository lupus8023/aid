interface Step2Props {
  outline: string;
  onBack: () => void;
  onNext: () => void;
  isLoading: boolean;
}

export default function Step2({ outline, onBack, onNext, isLoading }: Step2Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-l-4 border-[var(--accent-green)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">02.</span> Story Outline
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          AI-generated story structure and scene breakdown
        </p>
      </div>

      {/* Outline Display */}
      <div className="bg-[var(--bg-secondary)] p-6 rounded border border-[var(--border-color)]">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-mono text-[var(--accent-yellow)]">const</span>
          <span className="text-xs font-mono text-[var(--accent-green)]">outline</span>
          <span className="text-xs font-mono text-[var(--text-secondary)]">=</span>
        </div>
        <div className="bg-[var(--bg-primary)] p-4 rounded border border-[var(--border-color)] max-h-96 overflow-y-auto">
          <pre className="whitespace-pre-wrap text-sm font-mono text-[var(--text-primary)] leading-relaxed">{outline}</pre>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t border-[var(--border-color)]">
        <button
          onClick={onBack}
          className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
        >
          <span>←</span>
          <span>Back</span>
        </button>
        <button
          onClick={onNext}
          disabled={isLoading}
          className="bg-[var(--accent-blue)] text-white px-6 py-2.5 rounded font-mono text-sm hover:bg-[#0098ff] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <span className="animate-pulse">⚡</span>
              <span>Generating scenes...</span>
            </>
          ) : (
            <>
              <span>Next: Generate Scenes</span>
              <span>→</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
