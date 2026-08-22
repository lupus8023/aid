import type { Storyboard } from '@/types';
import { speechSeconds, storyboardAudioPlan, storyboardSpeech, validateSpeechContract, validateSpeechLanguage } from './speechAudioContract';

export const MAX_H3_SEGMENT_SECONDS = 15;
export const MAX_H3_STORYBOARDS_PER_SEGMENT = 4;

export interface VideoSegmentPlan {
  version: 1;
  source: 'auto' | 'manual';
  groups: string[][];
  storyboardSignature: string;
  updatedAt: string;
}

function generationHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Identifies the exact creative input represented by a generated H3 clip.
 * Runtime/cache fields are intentionally excluded so the value stays stable
 * after polling, downloading and restoring the same paid generation.
 */
export function videoSegmentGenerationSignature(storyboards: Storyboard[]): string {
  const payload = storyboards.map(storyboard => ({
    id: storyboard.id,
    sceneNumber: storyboard.sceneNumber,
    imageUrl: storyboard.imageUrl || '',
    description: storyboard.description,
    prompt: storyboard.prompt,
    action: storyboard.action || '',
    videoPrompt: storyboard.videoPromptOverride ? storyboard.videoPrompt || '' : '',
    speech: storyboard.speech || storyboard.dialogueLines || storyboard.dialogue || null,
    audioPlan: storyboard.audioPlan || null,
    shotSize: storyboard.shotSize || '',
    cameraMove: storyboard.cameraMove || '',
    angle: storyboard.angle || '',
    clipType: storyboard.clipType || '',
    dramaticPurpose: storyboard.dramaticPurpose || '',
    cause: storyboard.cause || '',
    conflict: storyboard.conflict || '',
    choice: storyboard.choice || '',
    consequence: storyboard.consequence || '',
    nextCause: storyboard.nextCause || '',
    informationGain: storyboard.informationGain || '',
    dialoguePurpose: storyboard.dialoguePurpose || '',
    montageRole: storyboard.montageRole || '',
    audienceQuestion: storyboard.audienceQuestion || '',
    durationHint: storyboard.durationHint || 0,
    transition: storyboard.transition || '',
    continuousFromPrev: Boolean(storyboard.continuousFromPrev),
    continuityFrom: storyboard.continuityFrom || '',
    aspectRatio: storyboard.aspectRatio || '',
    visualStyle: storyboard.visualStyle || '',
  }));
  return `h3-v3-${generationHash(JSON.stringify(payload))}`;
}

function storyboardSignature(storyboards: Storyboard[]): string {
  return storyboards.map(storyboard => storyboard.id).join('|');
}

export function estimateStoryboardBeatSeconds(storyboard: Storyboard): number {
  const lines = storyboardSpeech(storyboard);
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
  const clipType = storyboard.clipType || (lines.length ? 'dialogue' : 'action');
  const visual = Math.min(typeCeiling[clipType] || 7, Math.max(typeFloor[clipType] || 3.5, hint * 0.7));
  const spoken = lines.length
    ? lines.reduce((sum, line) => sum + speechSeconds(line.exactLine), 0)
      + Math.max(0, lines.length - 1) * 0.35
      + plan.silenceBefore
      + plan.silenceAfter
    : 0;
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
  const projectedSeconds = storyboards.reduce((sum, storyboard) => sum + estimateStoryboardBeatSeconds(storyboard), 0);
  if (projectedSeconds > MAX_H3_SEGMENT_SECONDS) return `该片段预计 ${Math.round(projectedSeconds)} 秒，超过 H3 的 ${MAX_H3_SEGMENT_SECONDS} 秒上限`;
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
    const projectedSpeech = [...current, storyboard].flatMap(storyboardSpeech);
    const speechLimitExceeded = projectedSpeech.length > 3
      || new Set(projectedSpeech.map(line => line.character)).size > 3;
    const wouldOverflow = currentSeconds + seconds > MAX_H3_SEGMENT_SECONDS;
    const previous = current[current.length - 1];
    const previousRole = String(previous?.montageRole || '').toLowerCase();
    const nextRole = String(storyboard.montageRole || '').toLowerCase();
    const closesDramaticUnit = /(?:payoff|resolution|收束|回收)/.test(previousRole);
    const opensDramaticUnit = /(?:setup|建立)/.test(nextRole);
    const explicitBridge = /(?:bridge|parallel|contrast|consequence|桥接|平行|对照|后果)/.test(nextRole);
    const newDramaticUnit = Boolean(previous && closesDramaticUnit && opensDramaticUnit && !explicitBridge);

    // H3 can perform several causal shots — including motivated location
    // changes — inside one 15-second clip. Location/sequence labels and
    // model-written fade/dissolve hints are therefore soft directing signals,
    // not mandatory generation boundaries. Hard-split only when the model's
    // real input/timeline limits would be exceeded.
    if (current.length >= MAX_H3_STORYBOARDS_PER_SEGMENT || speechLimitExceeded || wouldOverflow || newDramaticUnit) flush();

    current.push(storyboard);
    currentSeconds += seconds;
  }
  flush();
  return groups;
}

export function createVideoSegmentPlan(
  storyboards: Storyboard[],
  groups: Storyboard[][],
  source: VideoSegmentPlan['source'] = 'auto',
): VideoSegmentPlan {
  return {
    version: 1,
    source,
    groups: groups.filter(group => group.length).map(group => group.map(storyboard => storyboard.id)),
    storyboardSignature: storyboardSignature(storyboards),
    updatedAt: new Date().toISOString(),
  };
}

export function isValidVideoSegmentPlan(
  plan: VideoSegmentPlan | undefined,
  storyboards: Storyboard[],
  language?: 'zh' | 'en',
): plan is VideoSegmentPlan {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.groups) || !plan.groups.length) return false;
  if (plan.storyboardSignature !== storyboardSignature(storyboards)) return false;
  const ids = plan.groups.flat();
  if (ids.join('|') !== storyboardSignature(storyboards)) return false;
  if (new Set(ids).size !== ids.length) return false;
  const byId = new Map(storyboards.map(storyboard => [storyboard.id, storyboard]));
  return plan.groups.every(groupIds => {
    const group = groupIds.map(id => byId.get(id)).filter((item): item is Storyboard => Boolean(item));
    return group.length === groupIds.length
      && estimateVideoSegmentSeconds(group) <= MAX_H3_SEGMENT_SECONDS
      && !validateVideoSegment(group, language);
  });
}

export function resolveVideoSegmentGroups(
  storyboards: Storyboard[],
  plan?: VideoSegmentPlan,
  language?: 'zh' | 'en',
): Storyboard[][] {
  if (!isValidVideoSegmentPlan(plan, storyboards, language)) return suggestVideoSegments(storyboards);
  const byId = new Map(storyboards.map(storyboard => [storyboard.id, storyboard]));
  return plan.groups.map(group => group.map(id => byId.get(id)!));
}

export function isCompletedVideoSegment(storyboards: Storyboard[]): boolean {
  const leader = storyboards[0];
  if (!leader || !leader.videoUrl || !leader.videoSegmentId) return false;
  if (leader.videoGenerationSignature
    && leader.videoGenerationSignature !== videoSegmentGenerationSignature(storyboards)) return false;
  const expectedIds = storyboards.map(storyboard => storyboard.id);
  const savedIds = leader.videoSegmentStoryboardIds || [];
  if (savedIds.length !== expectedIds.length || savedIds.some((id, index) => id !== expectedIds[index])) return false;
  return storyboards.every(storyboard => (
    storyboard.videoStatus === 'completed'
    && storyboard.videoSegmentId === leader.videoSegmentId
  ));
}

function isPersistedVideoSegment(storyboards: Storyboard[]): boolean {
  const leader = storyboards[0];
  if (!leader || !leader.videoSegmentId || !hasPersistedVideoArtifact(leader)) return false;
  if (leader.videoGenerationSignature
    && leader.videoGenerationSignature !== videoSegmentGenerationSignature(storyboards)) return false;
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

export function restoredStoryStep(storyboards: Storyboard[], plan?: VideoSegmentPlan): 4 | 5 | 6 {
  if (!storyboards.length || storyboards.some(storyboard => !storyboard.imageUrl)) return 4;
  const groups = resolveVideoSegmentGroups(storyboards, plan);
  return groups.length > 0 && groups.every(isPersistedVideoSegment) ? 6 : 5;
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
