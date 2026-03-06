'use client';

import { Storyboard } from '@/types';
import StoryboardCard from './StoryboardCard';

interface StoryboardListProps {
  storyboards: Storyboard[];
  onRetry?: (storyboard: Storyboard) => void;
  onPreview?: (storyboard: Storyboard) => void;
  onGenerateVideo?: (storyboard: Storyboard) => void;
  onUpdate?: (storyboard: Storyboard) => void;
}

export default function StoryboardList({ storyboards, onRetry, onPreview, onGenerateVideo, onUpdate }: StoryboardListProps) {
  if (storyboards.length === 0) {
    return (
      <div className="bg-[var(--bg-secondary)] p-6 rounded border border-[var(--border-color)] text-center">
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          <span className="text-[var(--accent-orange)]">[]</span> No scenes generated yet
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-secondary)] p-6 rounded border border-[var(--border-color)]">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-mono text-[var(--accent-yellow)]">const</span>
        <span className="text-sm font-mono text-[var(--accent-green)]">scenes</span>
        <span className="text-sm font-mono text-[var(--text-secondary)]">=</span>
        <span className="text-sm font-mono text-[var(--accent-blue)]">[{storyboards.length}]</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {storyboards.map((storyboard) => (
          <StoryboardCard
            key={storyboard.id}
            storyboard={storyboard}
            onRetry={onRetry}
            onPreview={onPreview}
            onGenerateVideo={onGenerateVideo}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}
