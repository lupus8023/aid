'use client';

import { VideoClip } from './types';
import { Scissors } from 'lucide-react';

interface TrimPanelProps {
  clip: VideoClip;
  onTrimChange: (clipId: string, trimStart: number, trimEnd: number) => void;
}

export default function TrimPanel({ clip, onTrimChange }: TrimPanelProps) {
  const maxDuration = clip.duration;
  const availableDuration = clip.duration - clip.trimStart - clip.trimEnd;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4">
      <div className="flex items-center gap-2 mb-3">
        <Scissors size={14} className="text-[var(--accent-blue)]" />
        <span className="text-xs font-mono text-[var(--text-primary)]">Trim: {clip.name}</span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-[var(--text-secondary)] font-mono block mb-1">
            Trim Start: {clip.trimStart.toFixed(2)}s
          </label>
          <input
            type="range"
            min={0}
            max={maxDuration - clip.trimEnd - 0.1}
            step={0.1}
            value={clip.trimStart}
            onChange={(e) => onTrimChange(clip.id, parseFloat(e.target.value), clip.trimEnd)}
            className="w-full"
          />
        </div>

        <div>
          <label className="text-xs text-[var(--text-secondary)] font-mono block mb-1">
            Trim End: {clip.trimEnd.toFixed(2)}s
          </label>
          <input
            type="range"
            min={0}
            max={maxDuration - clip.trimStart - 0.1}
            step={0.1}
            value={clip.trimEnd}
            onChange={(e) => onTrimChange(clip.id, clip.trimStart, parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="text-xs text-[var(--text-secondary)] font-mono">
          Duration: {availableDuration.toFixed(2)}s / {maxDuration.toFixed(2)}s
        </div>
      </div>
    </div>
  );
}
