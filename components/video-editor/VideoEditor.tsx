'use client';

import { useState, useEffect } from 'react';
import { VideoClip } from './types';
import Timeline from './Timeline';
import VideoPreview from './VideoPreview';
import TrimPanel from './TrimPanel';
import { Play, Pause, Download } from 'lucide-react';
import { exportVideo } from '@/lib/video-exporter';

interface VideoEditorProps {
  initialVideos: string[];
}

export default function VideoEditor({ initialVideos }: VideoEditorProps) {
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => {
    const loadVideos = async () => {
      const loadedClips: VideoClip[] = [];
      let startTime = 0;

      for (let i = 0; i < initialVideos.length; i++) {
        const video = document.createElement('video');
        video.src = initialVideos[i];

        await new Promise((resolve) => {
          video.onloadedmetadata = () => {
            loadedClips.push({
              id: `clip-${i}`,
              url: initialVideos[i],
              name: `Scene ${i + 1}`,
              duration: video.duration,
              startTime,
              trimStart: 0,
              trimEnd: 0,
            });
            startTime += video.duration;
            resolve(null);
          };
        });
      }

      setClips(loadedClips);
    };

    if (initialVideos.length > 0) {
      loadVideos();
    }
  }, [initialVideos]);

  const totalDuration = clips.reduce((sum, clip) =>
    sum + (clip.duration - clip.trimStart - clip.trimEnd), 0
  );

  const handleTrimChange = (clipId: string, trimStart: number, trimEnd: number) => {
    const newClips = clips.map(clip =>
      clip.id === clipId ? { ...clip, trimStart, trimEnd } : clip
    );

    // 重新计算所有片段的 startTime
    let startTime = 0;
    newClips.forEach(clip => {
      clip.startTime = startTime;
      startTime += clip.duration - clip.trimStart - clip.trimEnd;
    });

    setClips(newClips);
  };

  const handleExport = async () => {
    if (clips.length === 0) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      const blob = await exportVideo(clips, setExportProgress);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `edited-video-${Date.now()}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentTime(prev => {
        if (prev >= totalDuration) {
          setIsPlaying(false);
          return 0;
        }
        return prev + 0.1;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, totalDuration]);

  return (
    <div className="h-full flex bg-[var(--bg-primary)]">
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4">
          <div className="max-w-2xl">
            <VideoPreview clips={clips} currentTime={currentTime} isPlaying={isPlaying} />
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || clips.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#5dd18d] text-white rounded disabled:opacity-50"
            >
              <Download size={16} />
              {isExporting ? `Exporting... ${Math.round(exportProgress)}%` : 'Export Video'}
            </button>
          </div>
        </div>

        <Timeline
          clips={clips}
          onClipsChange={setClips}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          onClipSelect={setSelectedClipId}
        />
      </div>

      {selectedClipId && (
        <div className="w-80 border-l border-[var(--border-color)] p-4 overflow-y-auto">
          <TrimPanel
            clip={clips.find(c => c.id === selectedClipId)!}
            onTrimChange={handleTrimChange}
          />
        </div>
      )}
    </div>
  );
}
