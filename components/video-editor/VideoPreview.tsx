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
  const [currentClipId, setCurrentClipId] = useState<string | null>(null);
  const lastClipIdRef = useRef<string | null>(null);

  const getCurrentClip = () => {
    let accumulatedTime = 0;
    for (const clip of clips) {
      const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
      if (currentTime >= accumulatedTime && currentTime < accumulatedTime + clipDuration) {
        return { clip, relativeTime: currentTime - accumulatedTime + clip.trimStart };
      }
      accumulatedTime += clipDuration;
    }
    return null;
  };

  useEffect(() => {
    const current = getCurrentClip();
    if (!current) return;

    const { clip, relativeTime } = current;
    const video = videoRefs.current.get(clip.id);
    if (!video) return;

    const clipChanged = lastClipIdRef.current !== clip.id;

    if (clipChanged) {
      // 先显示新视频，再隐藏旧视频，避免黑帧
      videoRefs.current.forEach((v, id) => {
        v.style.opacity = id === clip.id ? '1' : '0';
      });
      lastClipIdRef.current = clip.id;
      setCurrentClipId(clip.id);
      video.currentTime = relativeTime;
    }

    if (isPlaying) {
      video.play().catch(() => {});
      // 暂停其他视频
      videoRefs.current.forEach((v, id) => {
        if (id !== clip.id) v.pause();
      });
    } else {
      video.pause();
    }
  }, [currentTime, clips, isPlaying]);

  return (
    <div className="relative bg-black rounded aspect-video">
      {clips.map((clip) => (
        <video
          key={clip.id}
          ref={(el) => {
            if (el) videoRefs.current.set(clip.id, el);
          }}
          src={clip.url}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
          style={{ opacity: 0 }}
          muted
          preload="auto"
        />
      ))}
    </div>
  );
}
