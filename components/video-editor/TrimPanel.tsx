'use client';

import { VideoClip } from './types';
import { RotateCcw, Scissors, SkipBack, SkipForward } from 'lucide-react';
import { averagePacingRate, effectiveClipDuration } from '@/lib/videoPacing';

interface TrimPanelProps {
  clip: VideoClip;
  onTrimChange: (clipId: string, trimStart: number, trimEnd: number) => void;
  onSeek: (clipId: string, clipTime: number) => void;
}

export default function TrimPanel({ clip, onTrimChange, onSeek }: TrimPanelProps) {
  const minDuration = 0.1;
  const sourceDuration = Math.max(minDuration, clip.duration - clip.trimStart - clip.trimEnd);
  const availableDuration = Math.max(minDuration, effectiveClipDuration(clip));

  const clampTrim = (trimStart: number, trimEnd: number) => {
    const safeStart = Math.max(0, Math.min(trimStart, clip.duration - minDuration));
    const maxEnd = Math.max(0, clip.duration - safeStart - minDuration);
    const safeEnd = Math.max(0, Math.min(trimEnd, maxEnd));
    return { trimStart: safeStart, trimEnd: safeEnd };
  };

  const updateTrim = (trimStart: number, trimEnd: number) => {
    const next = clampTrim(trimStart, trimEnd);
    onTrimChange(clip.id, next.trimStart, next.trimEnd);
  };

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4">
      <div className="flex items-center gap-2 mb-3">
        <Scissors size={14} className="text-[var(--accent-blue)]" />
        <span className="text-xs font-mono text-[var(--text-primary)] truncate">Trim: {clip.name}</span>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-[var(--text-secondary)] font-mono">Trim Start</label>
            <input
              type="number"
              min={0}
              max={clip.duration - clip.trimEnd - minDuration}
              step={0.1}
              value={clip.trimStart.toFixed(1)}
              onChange={(e) => updateTrim(Number(e.target.value), clip.trimEnd)}
              className="w-20 px-2 py-1 text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)]"
            />
          </div>
          <input
            type="range"
            min={0}
            max={clip.duration - clip.trimEnd - minDuration}
            step={0.1}
            value={clip.trimStart}
            onChange={(e) => updateTrim(parseFloat(e.target.value), clip.trimEnd)}
            className="w-full"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-[var(--text-secondary)] font-mono">Trim End</label>
            <input
              type="number"
              min={0}
              max={clip.duration - clip.trimStart - minDuration}
              step={0.1}
              value={clip.trimEnd.toFixed(1)}
              onChange={(e) => updateTrim(clip.trimStart, Number(e.target.value))}
              className="w-20 px-2 py-1 text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)]"
            />
          </div>
          <input
            type="range"
            min={0}
            max={clip.duration - clip.trimStart - minDuration}
            step={0.1}
            value={clip.trimEnd}
            onChange={(e) => updateTrim(clip.trimStart, parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="text-xs text-[var(--text-secondary)] font-mono">
          成片 {availableDuration.toFixed(2)}s · 素材 {sourceDuration.toFixed(2)}s · {averagePacingRate(clip).toFixed(2)}×
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onSeek(clip.id, clip.trimStart)}
            className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded"
          >
            <SkipBack size={12} /> In
          </button>
          <button
            onClick={() => updateTrim(0, 0)}
            className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={() => onSeek(clip.id, clip.duration - clip.trimEnd)}
            className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded"
          >
            <SkipForward size={12} /> Out
          </button>
        </div>
      </div>
    </div>
  );
}
