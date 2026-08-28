'use client';

import { useState, useRef, useEffect } from 'react';
import { VideoClip } from './types';
import { Trash2, Move, ZoomIn, ZoomOut } from 'lucide-react';
import { averagePacingRate, effectiveClipDuration } from '@/lib/videoPacing';

interface TimelineProps {
  clips: VideoClip[];
  onClipsChange: (clips: VideoClip[]) => void;
  currentTime: number;
  onTimeChange: (time: number) => void;
  onClipSelect?: (clipId: string | null) => void;
}

const ZOOM_LEVELS = [10, 25, 50, 100];

export default function Timeline({ clips, onClipsChange, currentTime, onTimeChange, onClipSelect }: TimelineProps) {
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [draggingClip, setDraggingClip] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(2);
  const timelineRef = useRef<HTMLDivElement>(null);

  const totalDuration = clips.reduce((sum, clip) => sum + effectiveClipDuration(clip), 0);
  const pixelsPerSecond = ZOOM_LEVELS[zoomIndex];

  useEffect(() => {
    if (totalDuration > 120) setZoomIndex(0);
    else if (totalDuration > 60) setZoomIndex(1);
    else setZoomIndex(2);
  }, [totalDuration]);

  const handleClipClick = (clipId: string) => {
    setSelectedClip(clipId);
    onClipSelect?.(clipId);
  };

  const handleDeleteClip = () => {
    if (!selectedClip) return;
    const newClips = clips.filter(c => c.id !== selectedClip);
    setSelectedClip(null);
    onClipSelect?.(null);
    onClipsChange(newClips);
    const nextTotal = newClips.reduce((sum, clip) => sum + effectiveClipDuration(clip), 0);
    if (currentTime > nextTotal) onTimeChange(nextTotal);
  };

  const handleDragStart = (e: React.DragEvent, clipId: string) => {
    setDraggingClip(clipId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (!draggingClip) return;

    const dragIndex = clips.findIndex(c => c.id === draggingClip);
    if (dragIndex === -1 || dragIndex === dropIndex) {
      setDraggingClip(null);
      setDragOverIndex(null);
      return;
    }

    const newClips = [...clips];
    const [draggedClip] = newClips.splice(dragIndex, 1);
    newClips.splice(dropIndex, 0, draggedClip);

    onClipsChange(newClips);
    setDraggingClip(null);
    setDragOverIndex(null);
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const time = x / pixelsPerSecond;
    onTimeChange(Math.max(0, Math.min(time, totalDuration)));
  };

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  };

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
      const time = x / pixelsPerSecond;
      onTimeChange(Math.max(0, Math.min(time, totalDuration)));
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPlayhead, pixelsPerSecond, totalDuration, onTimeChange]);

  return (
    <div className="bg-[var(--bg-secondary)] border-t border-[var(--border-color)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={handleDeleteClip}
          disabled={!selectedClip}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--accent-red)] hover:bg-[#ff6b6b] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 size={14} />
          Delete
        </button>

        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => setZoomIndex(Math.max(0, zoomIndex - 1))}
            disabled={zoomIndex === 0}
            className="p-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded disabled:opacity-50"
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-xs text-[var(--text-secondary)] font-mono w-16 text-center">{pixelsPerSecond}px/s</span>
          <button
            onClick={() => setZoomIndex(Math.min(ZOOM_LEVELS.length - 1, zoomIndex + 1))}
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            className="p-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded disabled:opacity-50"
          >
            <ZoomIn size={14} />
          </button>
        </div>

        <span className="text-xs text-[var(--text-secondary)] font-mono ml-auto">
          {currentTime.toFixed(2)}s / {totalDuration.toFixed(2)}s
        </span>
      </div>

      <div
        ref={timelineRef}
        onClick={handleTimelineClick}
        className="relative h-24 bg-[var(--bg-primary)] rounded border border-[var(--border-color)] overflow-x-auto cursor-pointer"
      >
        <div style={{ minWidth: `${Math.max(totalDuration * pixelsPerSecond, 1)}px`, height: '100%', position: 'relative' }}>
          {clips.map((clip, index) => {
            const clipDuration = effectiveClipDuration(clip);
            const width = Math.max(32, clipDuration * pixelsPerSecond);
            const left = clip.startTime * pixelsPerSecond;

            return (
              <div
                key={clip.id}
                draggable
                onDragStart={(e) => handleDragStart(e, clip.id)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClipClick(clip.id);
                  onTimeChange(clip.startTime);
                }}
                className={`absolute top-2 h-20 rounded border-2 transition-all cursor-move ${
                  selectedClip === clip.id
                    ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] bg-opacity-30'
                    : 'border-[var(--border-color)] bg-[var(--bg-tertiary)]'
                } ${dragOverIndex === index ? 'opacity-50' : ''}`}
                style={{ left: `${left}px`, width: `${width}px` }}
              >
                <div className="p-2 text-xs font-mono text-[var(--text-primary)] truncate flex items-center gap-1">
                  <Move size={12} />
                  {clip.name}
                </div>
                <div className="px-2 text-[10px] font-mono text-[var(--text-secondary)]">
                  {clipDuration.toFixed(1)}s · {averagePacingRate(clip).toFixed(2)}×
                </div>
              </div>
            );
          })}

          <div
            onMouseDown={handlePlayheadMouseDown}
            className="absolute top-0 bottom-0 w-1 bg-[var(--accent-red)] cursor-ew-resize hover:w-2 transition-all"
            style={{ left: `${currentTime * pixelsPerSecond}px` }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-[var(--accent-red)] rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
