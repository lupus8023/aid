'use client';

import { useState, useEffect, useRef } from 'react';
import { VideoClip } from './types';
import Timeline from './Timeline';
import VideoPreview from './VideoPreview';
import TrimPanel from './TrimPanel';
import { Play, Pause, Download } from 'lucide-react';
import { exportVideo } from '@/lib/video-exporter';
import { exportVideoWithCompanion, hasPendingNativeExport } from '@/lib/companionVideoExporter';
import type { AppSettings } from '@/types';
import { CONTINUITY_HANDOFF_LEAD_SECONDS, CONTINUITY_HEAD_TRIM_SECONDS } from '@/lib/videoContinuity';
import type { StoryAspectRatio } from '@/lib/storyAspectRatio';

interface VideoEditorProps {
  initialVideos: string[];
  continuousFromPrevious?: boolean[];
  projectId?: string;
  projectName?: string;
  companionSettings?: Partial<NonNullable<AppSettings['comfyui']>>;
  aspectRatio?: StoryAspectRatio;
  autoExportRequestId?: number;
  onAutoExportComplete?: () => void;
  onAutoExportError?: (error: unknown) => void;
}

type ExportStatus = { progress: number; stage: string };
const EMPTY_CONTINUITY_FLAGS: boolean[] = [];

function recalculateStartTimes(clipList: VideoClip[]): VideoClip[] {
  let startTime = 0;
  return clipList.map(clip => {
    const next = { ...clip, startTime };
    startTime += Math.max(0, clip.duration - clip.trimStart - clip.trimEnd);
    return next;
  });
}

export default function VideoEditor({
  initialVideos,
  continuousFromPrevious,
  projectId,
  projectName,
  companionSettings,
  aspectRatio = '16:9',
  autoExportRequestId = 0,
  onAutoExportComplete,
  onAutoExportError,
}: VideoEditorProps) {
  const continuityFlags = continuousFromPrevious ?? EMPTY_CONTINUITY_FLAGS;
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ progress: 0, stage: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const recoveryStartedRef = useRef(false);
  const automaticRequestStartedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const loadVideos = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const loadedClips: VideoClip[] = [];
        let startTime = 0;

        for (let i = 0; i < initialVideos.length; i++) {
          const url = initialVideos[i];
          const duration = await new Promise<number>((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.src = url;
            video.onloadedmetadata = () => resolve(video.duration);
            video.onerror = () => reject(new Error(`Scene ${i + 1} metadata 加载失败`));
          });
          const trimStart = continuityFlags[i]
            ? Math.min(CONTINUITY_HEAD_TRIM_SECONDS, Math.max(0, duration - 0.1))
            : 0;

          loadedClips.push({
            id: `clip-${i}`,
            url,
            name: `Scene ${i + 1}`,
            duration,
            startTime,
            // A continuity-generated clip intentionally starts on the previous
            // clip's final still. Remove a few duplicated opening frames so the
            // hard join carries motion forward instead of visibly pausing.
            trimStart,
            trimEnd: 0,
          });
          startTime += duration - trimStart;
        }

        // Each continued clip starts from a frame sampled this far before the
        // previous clip ended. Trim that already-consumed tail so the join is
        // temporally monotonic, then let the head trim skip H3's motion ramp.
        for (let i = 1; i < loadedClips.length; i += 1) {
          if (!continuityFlags[i]) continue;
          const previous = loadedClips[i - 1];
          previous.trimEnd = Math.min(
            CONTINUITY_HANDOFF_LEAD_SECONDS,
            Math.max(0, previous.duration - previous.trimStart - 0.1),
          );
        }

        const timedClips = recalculateStartTimes(loadedClips);

        if (!cancelled) {
          setClips(timedClips);
          setSelectedClipId(timedClips[0]?.id ?? null);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '视频加载失败');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    if (initialVideos.length > 0) loadVideos();

    return () => { cancelled = true; };
  }, [initialVideos, continuityFlags]);

  const totalDuration = clips.reduce((sum, clip) =>
    sum + Math.max(0, clip.duration - clip.trimStart - clip.trimEnd), 0
  );

  const updateClips = (nextClips: VideoClip[]) => {
    const recalculated = recalculateStartTimes(nextClips);
    setClips(recalculated);
    setCurrentTime(prev => Math.min(prev, recalculated.reduce((sum, clip) => sum + Math.max(0, clip.duration - clip.trimStart - clip.trimEnd), 0)));
  };

  const handleTrimChange = (clipId: string, trimStart: number, trimEnd: number) => {
    updateClips(clips.map(clip =>
      clip.id === clipId ? { ...clip, trimStart, trimEnd } : clip
    ));
  };

  const seekToClipTime = (clipId: string, clipTime: number) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    setCurrentTime(Math.max(0, Math.min(totalDuration, clip.startTime + clipTime - clip.trimStart)));
  };

  const handleExport = async (automaticRecovery = false) => {
    if (clips.length === 0) return;

    setIsExporting(true);
    setExportStatus({ progress: 0, stage: '准备导出' });

    try {
      const a = document.createElement('a');
      if (projectId && companionSettings?.useLocalCompanion !== false) {
        const result = await exportVideoWithCompanion(clips, {
          projectId,
          projectName,
          aspectRatio,
          settings: companionSettings,
          onProgress: (progress, stage = '') => setExportStatus({ progress, stage }),
        });
        // A top-level navigation from HTTPS to 127.0.0.1 can be blocked by
        // Chromium extensions/private-network policy. Read only the finished
        // file from Companion, then download through a same-page blob URL.
        const url = URL.createObjectURL(result.blob);
        a.href = url;
        a.download = result.fileName;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const blob = await exportVideo(clips, (progress, stage = '') => {
          setExportStatus({ progress, stage });
        });
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `${projectName || 'AID-Story'}-${Date.now()}.mp4`;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      a.click();
    } catch (error) {
      console.error('Export failed:', error);
      if (!automaticRecovery) alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
      else setExportStatus({ progress: 0, stage: `自动恢复失败：${error instanceof Error ? error.message : '未知错误'}` });
      throw error;
    } finally {
      setIsExporting(false);
      if (!automaticRecovery) setExportStatus({ progress: 0, stage: '' });
    }
  };

  useEffect(() => {
    if (isLoading || clips.length === 0 || recoveryStartedRef.current || !projectId) return;
    if (autoExportRequestId > 0) return;
    if (!hasPendingNativeExport(projectId)) return;
    recoveryStartedRef.current = true;
    void handleExport(true).catch(() => undefined);
    // Recovery is intentionally evaluated only when this project's clips have
    // finished loading. The persistent marker is cleared only after success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, clips.length, projectId, autoExportRequestId]);

  useEffect(() => {
    if (isLoading || !loadError || autoExportRequestId <= 0) return;
    if (automaticRequestStartedRef.current === autoExportRequestId) return;
    automaticRequestStartedRef.current = autoExportRequestId;
    onAutoExportError?.(new Error(loadError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, loadError, autoExportRequestId]);

  useEffect(() => {
    if (isLoading || clips.length === 0 || autoExportRequestId <= 0) return;
    if (automaticRequestStartedRef.current === autoExportRequestId) return;
    automaticRequestStartedRef.current = autoExportRequestId;
    void handleExport(true).then(
      () => onAutoExportComplete?.(),
      error => onAutoExportError?.(error),
    );
    // The request id is the explicit retry token. Callback identity changes
    // must not start a second export for the same token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, clips.length, autoExportRequestId]);

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)] font-mono text-sm">Loading videos...</div>;
  }

  if (loadError) {
    return <div className="flex-1 flex items-center justify-center text-[var(--accent-red)] font-mono text-sm">{loadError}</div>;
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      <div className="flex gap-4 p-4 border-b border-[var(--border-color)]">
        <div className="flex-1">
          <VideoPreview
            clips={clips}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onTimeUpdate={setCurrentTime}
            onEnded={() => setIsPlaying(false)}
            aspectRatio={aspectRatio}
          />

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => {
                if (currentTime >= totalDuration) setCurrentTime(0);
                setIsPlaying(!isPlaying);
              }}
              disabled={clips.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded disabled:opacity-50"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={() => void handleExport(false).catch(() => undefined)}
              disabled={isExporting || clips.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#5dd18d] text-white rounded disabled:opacity-50"
            >
              <Download size={16} />
              {isExporting ? `Exporting... ${Math.round(exportStatus.progress)}%` : 'Export Video'}
            </button>
            {exportStatus.stage && (isExporting || exportStatus.stage.startsWith('自动恢复失败')) && (
              <span className={`text-xs font-mono ${exportStatus.stage.startsWith('自动恢复失败') ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                {exportStatus.stage}
              </span>
            )}
          </div>
        </div>

        {selectedClipId && clips.find(c => c.id === selectedClipId) && (
          <div className="w-80">
            <TrimPanel
              clip={clips.find(c => c.id === selectedClipId)!}
              onTrimChange={handleTrimChange}
              onSeek={seekToClipTime}
            />
          </div>
        )}
      </div>

      <Timeline
        clips={clips}
        onClipsChange={updateClips}
        currentTime={currentTime}
        onTimeChange={(time) => setCurrentTime(Math.max(0, Math.min(time, totalDuration)))}
        onClipSelect={setSelectedClipId}
      />
    </div>
  );
}
