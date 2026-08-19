'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import { VideoClip } from './types';
import { storyAspectClass, storyAspectRatioFromDimensions, type StoryAspectRatio } from '@/lib/storyAspectRatio';

interface VideoPreviewProps {
  clips: VideoClip[];
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onEnded: () => void;
  aspectRatio?: StoryAspectRatio;
}

export default function VideoPreview({ clips, currentTime, isPlaying, onTimeUpdate, onEnded, aspectRatio = '16:9' }: VideoPreviewProps) {
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const currentClipRef = useRef<string | null>(null);
  const lastReportedTimeRef = useRef(0);
  const [detectedAspects, setDetectedAspects] = useState<Record<string, StoryAspectRatio>>({});

  const timeline = useMemo(() => {
    let accumulatedTime = 0;
    return clips.map(clip => {
      const duration = Math.max(0, clip.duration - clip.trimStart - clip.trimEnd);
      const item = { clip, start: accumulatedTime, end: accumulatedTime + duration, duration };
      accumulatedTime += duration;
      return item;
    });
  }, [clips]);

  const totalDuration = timeline.at(-1)?.end ?? 0;

  const getCurrentClip = () => {
    if (timeline.length === 0) return null;

    const clampedTime = Math.max(0, Math.min(currentTime, totalDuration));
    const found = timeline.find(item => clampedTime >= item.start && clampedTime < item.end) ?? timeline[timeline.length - 1];
    return {
      clip: found.clip,
      timelineStart: found.start,
      relativeTime: Math.min(found.clip.duration - found.clip.trimEnd, clampedTime - found.start + found.clip.trimStart),
    };
  };
  const activeClipId = getCurrentClip()?.clip.id;
  const activeAspectRatio = (activeClipId && detectedAspects[activeClipId]) || aspectRatio;

  useEffect(() => {
    const current = getCurrentClip();
    if (!current) return;

    const { clip, relativeTime } = current;
    const video = videoRefs.current.get(clip.id);
    if (!video) return;

    videoRefs.current.forEach((v, id) => {
      const active = id === clip.id;
      v.style.opacity = active ? '1' : '0';
      if (!active) v.pause();
    });

    const clipChanged = currentClipRef.current !== clip.id;
    currentClipRef.current = clip.id;

    if (clipChanged || Math.abs(video.currentTime - relativeTime) > 0.15) {
      video.currentTime = relativeTime;
    }

    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [currentTime, clips, isPlaying, totalDuration]);

  return (
    <div className={`relative mx-auto max-h-[62vh] overflow-hidden rounded bg-black ${storyAspectClass(activeAspectRatio)} ${activeAspectRatio === '9:16' ? 'max-w-[360px]' : 'w-full'}`}>
      {clips.map((clip, index) => (
        <video
          key={clip.id}
          ref={(el) => {
            if (el) videoRefs.current.set(clip.id, el);
            else videoRefs.current.delete(clip.id);
          }}
          src={clip.url}
          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
          style={{ opacity: index === 0 ? 1 : 0 }}
          muted
          preload="auto"
          onLoadedMetadata={(event) => {
            const detected = storyAspectRatioFromDimensions(event.currentTarget.videoWidth, event.currentTarget.videoHeight, aspectRatio);
            setDetectedAspects(current => current[clip.id] === detected ? current : { ...current, [clip.id]: detected });
          }}
          onTimeUpdate={(e) => {
            const current = getCurrentClip();
            if (!current || current.clip.id !== clip.id) return;

            const videoTime = e.currentTarget.currentTime;
            const clipEnd = clip.duration - clip.trimEnd;
            const globalTime = current.timelineStart + Math.max(0, videoTime - clip.trimStart);

            if (videoTime >= clipEnd - 0.05) {
              if (globalTime >= totalDuration - 0.05) {
                onTimeUpdate(totalDuration);
                onEnded();
              } else {
                onTimeUpdate(Math.min(totalDuration, current.timelineStart + current.clip.duration - current.clip.trimStart - current.clip.trimEnd));
              }
              return;
            }

            if (Math.abs(globalTime - lastReportedTimeRef.current) > 0.05) {
              lastReportedTimeRef.current = globalTime;
              onTimeUpdate(Math.min(globalTime, totalDuration));
            }
          }}
        />
      ))}
    </div>
  );
}
