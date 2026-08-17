import type { Storyboard } from '@/types';

export const MAX_H3_SEGMENT_SECONDS = 15;
export const MAX_H3_STORYBOARDS_PER_SEGMENT = 4;

function dialogueSeconds(storyboard: Storyboard): number {
  const text = (storyboard.dialogueLines || []).map(line => line.text).join(' ')
    || Object.values(storyboard.dialogue || {}).join(' ');
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9']+/g) || []).length;
  return han / 4 + words / 2.5;
}

export function estimateStoryboardBeatSeconds(storyboard: Storyboard): number {
  const spoken = dialogueSeconds(storyboard);
  const visual = Math.min(4, Math.max(2, Number(storyboard.durationHint || storyboard.videoDuration || 5) * 0.6));
  return Math.min(MAX_H3_SEGMENT_SECONDS, Math.max(visual, spoken ? spoken + 0.8 : 0));
}

export function estimateVideoSegmentSeconds(storyboards: Storyboard[]): number {
  const total = storyboards.reduce((sum, storyboard) => sum + estimateStoryboardBeatSeconds(storyboard), 0);
  return Math.min(MAX_H3_SEGMENT_SECONDS, Math.max(5, Math.round(total)));
}

export function areContiguousStoryboards(storyboards: Storyboard[]): boolean {
  return storyboards.every((storyboard, index) => index === 0 || storyboard.sceneNumber === storyboards[index - 1].sceneNumber + 1);
}

export function validateVideoSegment(storyboards: Storyboard[]): string | undefined {
  if (!storyboards.length) return '请至少选择一个分镜';
  if (storyboards.length > MAX_H3_STORYBOARDS_PER_SEGMENT) return `一个 H3 片段最多选择 ${MAX_H3_STORYBOARDS_PER_SEGMENT} 个分镜`;
  if (!areContiguousStoryboards(storyboards)) return '同一视频片段只能选择连续分镜';
  if (storyboards.some(storyboard => !storyboard.imageUrl)) return '所选分镜必须先完成分镜图';
  return undefined;
}

export function suggestVideoSegments(storyboards: Storyboard[]): Storyboard[][] {
  const groups: Storyboard[][] = [];
  let current: Storyboard[] = [];
  let currentSeconds = 0;

  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    currentSeconds = 0;
  };

  for (const storyboard of storyboards) {
    const seconds = estimateStoryboardBeatSeconds(storyboard);
    const previous = current.at(-1);
    const locationChanged = Boolean(previous && storyboard.locationId && previous.locationId && storyboard.locationId !== previous.locationId);
    const sequenceChanged = Boolean(previous && storyboard.sequenceId && previous.sequenceId && storyboard.sequenceId !== previous.sequenceId);
    const wouldOverflow = currentSeconds + seconds > MAX_H3_SEGMENT_SECONDS;
    if (current.length >= MAX_H3_STORYBOARDS_PER_SEGMENT || locationChanged || sequenceChanged || wouldOverflow) flush();

    current.push(storyboard);
    currentSeconds += seconds;
    if (storyboard.transition === 'fade' || storyboard.transition === 'dissolve') flush();
  }
  flush();
  return groups;
}

export function isCompletedVideoSegment(storyboards: Storyboard[]): boolean {
  const leader = storyboards[0];
  if (!leader || !leader.videoUrl || !leader.videoSegmentId) return false;
  const expectedIds = storyboards.map(storyboard => storyboard.id);
  const savedIds = leader.videoSegmentStoryboardIds || [];
  if (savedIds.length !== expectedIds.length || savedIds.some((id, index) => id !== expectedIds[index])) return false;
  return storyboards.every(storyboard => (
    storyboard.videoStatus === 'completed'
    && storyboard.videoSegmentId === leader.videoSegmentId
  ));
}

function hasPersistedVideoArtifact(storyboard: Storyboard): boolean {
  return storyboard.videoStatus === 'completed' && Boolean(
    storyboard.videoUrl
    || storyboard.videoCacheKey
    || storyboard.videoSourceUrl
    || storyboard.videoTaskId,
  );
}

export function persistedVideoClipCount(storyboards: Storyboard[], cachedOnly = false): number {
  const seen = new Set<string>();
  return storyboards.filter(storyboard => {
    if (!hasPersistedVideoArtifact(storyboard)) return false;
    if (cachedOnly && storyboard.videoCacheStatus !== 'completed') return false;
    const key = storyboard.videoSegmentId || storyboard.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).length;
}

export function restoredStoryStep(storyboards: Storyboard[]): 4 | 5 | 6 {
  if (!storyboards.length || storyboards.some(storyboard => !storyboard.imageUrl)) return 4;
  const groups = suggestVideoSegments(storyboards);
  return groups.length > 0 && persistedVideoClipCount(storyboards) >= groups.length ? 6 : 5;
}

export function allocateSegmentTimeline(storyboards: Storyboard[], totalSeconds: number): Array<{ start: number; end: number }> {
  const weights = storyboards.map(estimateStoryboardBeatSeconds);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || storyboards.length || 1;
  let cursor = 0;
  return weights.map((weight, index) => {
    const start = cursor;
    const end = index === weights.length - 1
      ? totalSeconds
      : Math.round((cursor + (weight / totalWeight) * totalSeconds) * 10) / 10;
    cursor = end;
    return { start, end };
  });
}
