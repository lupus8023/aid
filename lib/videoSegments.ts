import type { Storyboard } from '@/types';
import { speechSeconds, storyboardAudioPlan, storyboardSpeech, validateSpeechContract, validateSpeechLanguage } from './speechAudioContract';

export const MAX_H3_SEGMENT_SECONDS = 15;
export const MAX_H3_STORYBOARDS_PER_SEGMENT = 4;

export function estimateStoryboardBeatSeconds(storyboard: Storyboard): number {
  const line = storyboardSpeech(storyboard)[0];
  const plan = storyboardAudioPlan(storyboard);
  const hint = Number(storyboard.durationHint || storyboard.videoDuration || 5);
  const typeFloor: Record<string, number> = {
    insert: 2, reaction: 3, establishing: 3, action: 3.5,
    dialogue: 5, performance: 5, montage: 2, long_take: 10,
  };
  const typeCeiling: Record<string, number> = {
    insert: 4, reaction: 5, establishing: 6, action: 7,
    dialogue: 8, performance: 8, montage: 4, long_take: 15,
  };
  const clipType = storyboard.clipType || (line ? 'dialogue' : 'action');
  const visual = Math.min(typeCeiling[clipType] || 7, Math.max(typeFloor[clipType] || 3.5, hint * 0.7));
  const spoken = line ? speechSeconds(line.exactLine) + plan.silenceBefore + plan.silenceAfter : 0;
  return Math.min(MAX_H3_SEGMENT_SECONDS, Math.max(visual, spoken));
}

export function estimateVideoSegmentSeconds(storyboards: Storyboard[]): number {
  const total = storyboards.reduce((sum, storyboard) => sum + estimateStoryboardBeatSeconds(storyboard), 0);
  return Math.min(MAX_H3_SEGMENT_SECONDS, Math.max(3, Math.round(total)));
}

export function areContiguousStoryboards(storyboards: Storyboard[]): boolean {
  return storyboards.every((storyboard, index) => index === 0 || storyboard.sceneNumber === storyboards[index - 1].sceneNumber + 1);
}

export function validateVideoSegment(storyboards: Storyboard[], language?: 'zh' | 'en'): string | undefined {
  if (!storyboards.length) return '请至少选择一个分镜';
  if (storyboards.length > MAX_H3_STORYBOARDS_PER_SEGMENT) return `一个 H3 片段最多选择 ${MAX_H3_STORYBOARDS_PER_SEGMENT} 个分镜`;
  if (!areContiguousStoryboards(storyboards)) return '同一视频片段只能选择连续分镜';
  if (storyboards.some(storyboard => !storyboard.imageUrl)) return '所选分镜必须先完成分镜图';
  const speechError = validateSpeechContract(storyboards);
  if (speechError) return speechError;
  const languageError = validateSpeechLanguage(storyboards, language);
  if (languageError) return languageError;
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
    const projectedSpeech = [...current, storyboard].flatMap(storyboardSpeech);
    const speechLimitExceeded = projectedSpeech.length > 3
      || new Set(projectedSpeech.map(line => line.character)).size > 3;
    const dramaticBreak = Boolean(previous && (
      previous.consequence && storyboard.cause && previous.consequence !== storyboard.cause
      && (previous.transition === 'fade' || storyboard.clipType === 'establishing')
    ));
    const wouldOverflow = currentSeconds + seconds > MAX_H3_SEGMENT_SECONDS;
    if (current.length >= MAX_H3_STORYBOARDS_PER_SEGMENT || locationChanged || sequenceChanged || speechLimitExceeded || dramaticBreak || wouldOverflow) flush();

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
