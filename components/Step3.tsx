import StoryboardList from './StoryboardList';
import { Storyboard } from '@/types';

interface Step3Props {
  storyboards: Storyboard[];
  onBack: () => void;
  onNext: () => void;
  onRetry?: (storyboard: Storyboard) => void;
  onGenerateVideo?: (storyboard: Storyboard) => void;
}

export default function Step3({ storyboards, onBack, onNext, onRetry, onGenerateVideo }: Step3Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-l-4 border-[var(--accent-orange)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">03.</span> Scene Breakdown
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Review generated storyboard scenes before rendering
        </p>
      </div>

      <StoryboardList storyboards={storyboards} onRetry={onRetry} onGenerateVideo={onGenerateVideo} />

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
          className="bg-[var(--accent-green)] text-[var(--bg-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[#5dd18d] transition-colors flex items-center gap-2"
        >
          <span>Start Rendering</span>
          <span>→</span>
        </button>
      </div>
    </div>
  );
}
