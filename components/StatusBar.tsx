'use client';

import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface StatusBarProps {
  totalScenes: number;
  completedScenes: number;
  failedScenes: number;
  isGenerating: boolean;
  currentTask?: string;
}

export default function StatusBar({
  totalScenes,
  completedScenes,
  failedScenes,
  isGenerating,
  currentTask
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between w-full">
      {/* Left: Status Info */}
      <div className="flex items-center gap-4">
        {isGenerating && (
          <div className="flex items-center gap-2 text-[var(--accent-blue)] font-mono text-xs">
            <Loader2 size={12} className="animate-spin" />
            <span>{currentTask || 'Processing...'}</span>
          </div>
        )}

        {!isGenerating && completedScenes === totalScenes && totalScenes > 0 && (
          <div className="flex items-center gap-2 text-[var(--success)] font-mono text-xs">
            <CheckCircle2 size={12} />
            <span>All tasks completed</span>
          </div>
        )}
      </div>

      {/* Right: Progress Stats */}
      <div className="flex items-center gap-4 text-[var(--text-secondary)] font-mono text-xs">
        <span className="flex items-center gap-1">
          <CheckCircle2 size={12} className="text-[var(--success)]" />
          Done: {completedScenes}
        </span>

        {failedScenes > 0 && (
          <span className="flex items-center gap-1">
            <AlertCircle size={12} className="text-[var(--error)]" />
            Failed: {failedScenes}
          </span>
        )}

        <span>Total: {totalScenes}</span>
      </div>
    </div>
  );
}
