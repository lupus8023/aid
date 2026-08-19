import type { Storyboard } from '@/types';

export type StoryAspectRatio = '16:9' | '9:16' | '1:1';

export function storyAspectClass(aspectRatio: StoryAspectRatio | string | undefined): string {
  if (aspectRatio === '9:16') return 'aspect-[9/16]';
  if (aspectRatio === '1:1') return 'aspect-square';
  return 'aspect-video';
}

export function normalizeStoryAspectRatio(value: unknown): StoryAspectRatio {
  if (value === '1:1') return '1:1';
  return value === '9:16' ? '9:16' : '16:9';
}

export function projectStoryAspectRatio(
  projectRatio: unknown,
  storyboards: Array<Pick<Storyboard, 'aspectRatio'>> = [],
  fallback: unknown = '16:9',
): StoryAspectRatio {
  if (projectRatio === '16:9' || projectRatio === '9:16' || projectRatio === '1:1') return projectRatio;
  const storyboardRatio = storyboards.find(item => item.aspectRatio === '16:9' || item.aspectRatio === '9:16' || item.aspectRatio === '1:1')?.aspectRatio;
  return normalizeStoryAspectRatio(storyboardRatio || fallback);
}

export function hasStoryMedia(storyboards: Storyboard[]): boolean {
  return storyboards.some(item => Boolean(
    item.imageUrl || item.taskId || item.videoUrl || item.videoSourceUrl || item.videoTaskId || item.videoCacheKey,
  ));
}

export function applyStoryAspectRatio(storyboards: Storyboard[], aspectRatio: StoryAspectRatio): Storyboard[] {
  return storyboards.map(item => ({
    ...item,
    aspectRatio,
    imageUrl: undefined,
    gridSourceUrl: undefined,
    taskId: undefined,
    status: 'pending',
    videoUrl: undefined,
    videoSourceUrl: undefined,
    videoCacheKey: undefined,
    videoCacheStatus: undefined,
    videoCachedAt: undefined,
    videoSegmentId: undefined,
    videoSegmentStoryboardIds: undefined,
    videoStatus: 'pending',
    videoTaskId: undefined,
  }));
}
