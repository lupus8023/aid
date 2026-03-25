'use client';

import { useRef, useEffect, useState } from 'react';
import { VideoClip } from './types';

interface VideoPreviewProps {
  clips: VideoClip[];
  currentTime: number;
  isPlaying: boolean;
}

export default function VideoPreview({ clips, currentTime, isPlaying }: VideoPreviewProps) {
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentClipId, setCurrentClipId] = useState<string | null>(null);

  const getCurrentClip = () => {
    let accumulatedTime = 0;
    for (const clip of clips) {
      const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
      if (currentTime >= accumulatedTime && currentTime < accumulatedTime + clipDuration) {
        const relativeTime = currentTime - accumulatedTime + clip.trimStart;
        return { clip, relativeTime };
      }
      accumulatedTime += clipDuration;
    }
    return null;
  };

  useEffect(() => {
    const current = getCurrentClip();
    if (!current) return;

    const video = videoRefs.current.get(current.clip.id);
    if (!video) return;

    // 隐藏所有视频
    videoRefs.current.forEach((v, id) => {
      v.style.display = id === current.clip.id ? 'block' : 'none';
    });

    setCurrentClipId(current.clip.id);
    video.currentTime = current.relativeTime;

    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [currentTime, clips, isPlaying]);

  return (
    <div ref={containerRef} className="relative bg-black rounded aspect-video flex items-center justify-center overflow-hidden">
      {clips.map((clip) => (
        <video
          key={clip.id}
          ref={(el) => {
            if (el) videoRefs.current.set(clip.id, el);
          }}
          src={clip.url}
          className="w-full h-full object-contain"
          style={{ display: 'none' }}
          muted
          preload="auto"
        />
      ))}
    </div>
  );
}
