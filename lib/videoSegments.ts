import type { Storyboard, StorySpeechLine } from '@/types';
import { hasLegacyAutomaticContinuity } from './videoContinuity';
import { compileTimedSpeech, consolidateSegmentSpeech, H3_SPEAKER_HANDOFF_SECONDS, speechSeconds, storyboardAudioPlan, storyboardSpeech, validateSpeechContract, validateSpeechLanguage, validateVoiceBindings } from './speechAudioContract';

export const MAX_H3_SEGMENT_SECONDS = 15;
export const MAX_H3_STORYBOARDS_PER_SEGMENT = 4;
export const VIDEO_SEGMENT_PLANNING_CONTRACT = 'cinematic-edit-v2';
// Bump this whenever the compiled H3 direction/audio contract changes. Paid
// clips generated under an older contract must not be mistaken for valid cache
// hits after a prompt-engine fix.
export const H3_PROMPT_CONTRACT_VERSION = 'h3-v35';

export interface VideoSegmentDefinition {
  id: string;
  storyboardIds: string[];
  // The segment owns exact dialogue. Storyboards are visual references and
  // may only point at these ordered events through their time windows.
  speech: StorySpeechLine[];
}

export interface VideoSegmentPlan {
  version: 2;
  source: 'auto' | 'manual';
  planningContract: typeof VIDEO_SEGMENT_PLANNING_CONTRACT;
  segments: VideoSegmentDefinition[];
  // Kept as a compact compatibility/index field for existing UI code and
  // exported projects. `segments[].storyboardIds` is the authority.
  groups: string[][];
  storyboardSignature: string;
  updatedAt: string;
}

function segmentId(storyboardIds: string[], index: number): string {
  return `segment-${index + 1}-${generationHash(storyboardIds.join('|'))}`;
}

export function authorSegmentSpeech(storyboards: Storyboard[]): StorySpeechLine[] {
  return consolidateSegmentSpeech(storyboards).map(line => ({
    speakerId: line.speakerId,
    character: line.character,
    voiceId: line.voiceId,
    exactLine: line.exactLine,
    emotion: line.emotion,
    delivery: line.delivery,
    volume: line.volume,
    lipSync: line.lipSync,
    listenerState: line.listenerState,
    storyFunction: line.storyFunction,
    respondsTo: line.respondsTo,
    contentGoal: line.contentGoal,
    source: line.source,
    sourceStoryboardId: storyboards[line.storyboardIndex]?.id || storyboards[0]?.id,
  }));
}

function materializeSegmentStoryboards(
  storyboards: Storyboard[],
  definition: Pick<VideoSegmentDefinition, 'speech'>,
): Storyboard[] {
  return storyboards.map((storyboard, index) => ({
    ...storyboard,
    // An explicit empty array is important: storyboardSpeech treats it as a
    // segment-authority silence and never falls back to legacy dialogueLines.
    speech: definition.speech
      .filter(line => (line.sourceStoryboardId || storyboards[0]?.id) === storyboard.id)
      .map(line => ({ ...line, sourceStoryboardId: line.sourceStoryboardId || storyboards[index]?.id })),
    dialogueLines: undefined,
    dialogue: undefined,
  }));
}

/**
 * A browser refresh can persist the optimistic `generating` flag before the
 * Companion returns a durable task id. With no task id there is nothing to
 * poll or recover, so keeping the flag would permanently disable retry even
 * though ComfyUI has no job. Release the whole logical segment together; only
 * its leader owns the task id in the normal persisted representation.
 */
export function releaseUnsubmittedVideoGenerations(storyboards: Storyboard[]): Storyboard[] {
  const recoverableSegments = new Set(
    storyboards
      .filter(storyboard => storyboard.videoStatus === 'generating' && Boolean(storyboard.videoTaskId))
      .map(storyboard => storyboard.videoSegmentId || storyboard.id),
  );
  let changed = false;
  const next = storyboards.map(storyboard => {
    if (storyboard.videoStatus !== 'generating') return storyboard;
    const segmentKey = storyboard.videoSegmentId || storyboard.id;
    if (recoverableSegments.has(segmentKey)) return storyboard;
    changed = true;
    return {
      ...storyboard,
      videoStatus: 'failed' as const,
      videoTaskId: undefined,
    };
  });
  return changed ? next : storyboards;
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
    performance: storyboard.performance || [],
    videoDirection: storyboard.videoDirection || null,
    videoDirectionSource: storyboard.videoDirectionSource || '',
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
    dialogueUnitId: storyboard.dialogueUnitId || '',
    dialogueObligation: storyboard.dialogueObligation || '',
    dialogueContext: storyboard.dialogueContext || '',
    dialogueTurns: storyboard.dialogueTurns || [],
    montageRole: storyboard.montageRole || '',
    editBridge: storyboard.editBridge || '',
    audienceQuestion: storyboard.audienceQuestion || '',
    durationHint: storyboard.durationHint || 0,
    ...(storyboard.videoEndingMinimumDuration ? { videoEndingMinimumDuration: storyboard.videoEndingMinimumDuration } : {}),
    ...(storyboard.videoDuplicateRepairPrompt ? { videoDuplicateRepairPrompt: storyboard.videoDuplicateRepairPrompt } : {}),
    transition: storyboard.transition || '',
    continuousFromPrev: Boolean(storyboard.continuousFromPrev),
    ...(storyboard.videoStartMode === 'previous-segment-tail' ? { videoStartMode: storyboard.videoStartMode } : {}),
    continuityFrom: storyboard.continuityFrom || '',
    aspectRatio: storyboard.aspectRatio || '',
    visualStyle: storyboard.visualStyle || '',
    capturePreset: storyboard.capturePreset || '',
    videoProviderUsed: storyboard.videoProviderUsed || '',
    videoSeed: Number.isInteger(storyboard.videoSeed) ? storyboard.videoSeed : null,
  }));
  return `${H3_PROMPT_CONTRACT_VERSION}-${generationHash(JSON.stringify(payload))}`;
}

function storyboardSignature(storyboards: Storyboard[]): string {
  return storyboards.map(storyboard => storyboard.id).join('|');
}

function estimateStoryboardVisualSeconds(storyboard: Storyboard): number {
  const hint = Number(storyboard.durationHint || storyboard.videoDuration || 5);
  const typeFloor: Record<string, number> = {
    insert: 1.7, reaction: 2.4, establishing: 2.7, action: 2.8,
    dialogue: 5, performance: 5, montage: 1.8, long_take: 8,
  };
  const typeCeiling: Record<string, number> = {
    insert: 3.5, reaction: 4.5, establishing: 5.5, action: 6,
    dialogue: 8, performance: 8, montage: 4, long_take: 15,
  };
  const clipType = storyboard.clipType || (storyboardSpeech(storyboard).length ? 'dialogue' : 'action');
  return Math.min(typeCeiling[clipType] || 6, Math.max(typeFloor[clipType] || 2.8, hint * 0.6));
}

export function estimateStoryboardBeatSeconds(storyboard: Storyboard): number {
  const rawLines = storyboardSpeech(storyboard);
  let lines = rawLines;
  try {
    lines = consolidateSegmentSpeech([storyboard]);
  } catch {
    // Keep the raw order for an invalid A-B-A exchange so the estimator stays
    // conservative; validation will surface the actionable contract error.
  }
  const plan = storyboardAudioPlan(storyboard);
  const visual = estimateStoryboardVisualSeconds(storyboard);
  const spoken = lines.length
    ? lines.reduce((sum, line) => sum + speechSeconds(line.exactLine), 0)
      + Math.max(0, lines.length - 1) * H3_SPEAKER_HANDOFF_SECONDS
      // compileTimedSpeech always reserves at least 0.8s before and 1s
      // after speech. The estimator must use the same floor or proportional
      // allocation can give a beat less time than the compiler will accept.
      + Math.max(0.8, plan.silenceBefore)
      + Math.max(1, plan.silenceAfter)
    : 0;
  return Math.min(MAX_H3_SEGMENT_SECONDS, Math.max(visual, spoken));
}

function projectedVideoSegmentSeconds(storyboards: Storyboard[]): number {
  const visual = storyboards.reduce((sum, storyboard) => sum + estimateStoryboardVisualSeconds(storyboard), 0);
  let speech = 0;
  try {
    const lines = consolidateSegmentSpeech(storyboards);
    if (lines.length) {
      speech = lines.reduce((sum, line) => sum + speechSeconds(line.exactLine), 0)
        + Math.max(0, lines.length - 1) * H3_SPEAKER_HANDOFF_SECONDS
        + Math.max(0.8, storyboardAudioPlan(storyboards[lines[0].storyboardIndex]).silenceBefore)
        + Math.max(1, storyboardAudioPlan(storyboards[lines[lines.length - 1].storyboardIndex]).silenceAfter);
    }
  } catch {
    // Invalid speaker recurrence remains conservative until validation emits
    // the actionable split error.
    speech = storyboards.reduce((sum, storyboard) => sum + estimateStoryboardBeatSeconds(storyboard), 0);
  }
  return Math.max(visual, speech);
}

export function estimateVideoSegmentSeconds(storyboards: Storyboard[]): number {
  const total = projectedVideoSegmentSeconds(storyboards);
  const firstCandidate = Math.max(3, Math.ceil(total));
  // The raw speech sum is not sufficient when a line belongs to a later
  // storyboard: compileTimedSpeech must delay that speaker until the relevant
  // picture is on screen. Probe the exact production timeline and choose the
  // shortest whole-second duration that the final compiler will accept. This
  // turns a nominal 6s / actual 6.2s mismatch into a valid 7s request before
  // any paid generation is submitted.
  for (let seconds = firstCandidate; seconds <= MAX_H3_SEGMENT_SECONDS; seconds += 1) {
    try {
      compileTimedSpeech(storyboards, allocateSegmentTimeline(storyboards, seconds));
      return seconds;
    } catch {
      // Keep probing. validateVideoSegment reports the specific speech
      // contract error first; this loop only answers whether a duration fits.
    }
  }
  // A value above the model limit tells automatic grouping to split this
  // segment instead of silently clamping it back to an impossible 15 seconds.
  return MAX_H3_SEGMENT_SECONDS + 1;
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
  const voiceError = validateVoiceBindings(storyboards);
  if (voiceError) return voiceError;
  const languageError = validateSpeechLanguage(storyboards, language);
  if (languageError) return languageError;
  const playableSeconds = estimateVideoSegmentSeconds(storyboards);
  if (playableSeconds > MAX_H3_SEGMENT_SECONDS) return `该片段按分镜出场时机与完整台词计算后超过 H3 的 ${MAX_H3_SEGMENT_SECONDS} 秒上限，请缩短台词或拆分片段`;
  return undefined;
}

export type CinematicEditKind =
  | 'dialogue-reverse'
  | 'action-reaction'
  | 'detail-insert'
  | 'insert-return'
  | 'establish-develop'
  | 'rhythmic-montage'
  | 'match-continuity'
  | 'progressive-coverage'
  | 'motivated-transition'
  | 'direct-cut';

function normalizedEditorialText(storyboard: Storyboard): string {
  return [
    storyboard.clipType,
    storyboard.montageRole,
    storyboard.dramaticPurpose,
    storyboard.dialoguePurpose,
    storyboard.editBridge,
  ].filter(Boolean).join(' ').toLowerCase();
}

function framingScale(storyboard: Storyboard): number | undefined {
  const framing = `${storyboard.shotSize || ''} ${storyboard.angle || ''}`.toLowerCase();
  if (/大特写|extreme close/.test(framing)) return 0;
  if (/特写|close/.test(framing)) return 1;
  if (/近景|medium close/.test(framing)) return 2;
  if (/中景|medium/.test(framing)) return 3;
  if (/全景|full shot/.test(framing)) return 4;
  if (/远景|wide|long shot/.test(framing)) return 5;
  return undefined;
}

function hasSharedValue(left: string[] | undefined, right: string[] | undefined): boolean {
  const values = new Set((left || []).map(value => value.trim().toLowerCase()).filter(Boolean));
  return (right || []).some(value => values.has(value.trim().toLowerCase()));
}

function isExplicitEditorialBridge(previous: Storyboard, current: Storyboard): boolean {
  const source = `${previous.editBridge || ''} ${current.editBridge || ''} ${previous.montageRole || ''} ${current.montageRole || ''}`.toLowerCase();
  return current.continuousFromPrev
    || current.continuityFrom === previous.id
    || /match.?cut|graphic match|sound bridge|action bridge|匹配剪辑|匹配转场|声音桥|动作桥|桥接|bridge/.test(source);
}

/**
 * Names the editorial relationship between two consecutive storyboards. The
 * same classifier drives automatic grouping and the H3 cut instruction so a
 * planned action/reaction pair cannot degrade into two unrelated keyframes.
 */
export function cinematicEditKind(previous: Storyboard, current: Storyboard): CinematicEditKind {
  const previousSpeech = storyboardSpeech(previous);
  const currentSpeech = storyboardSpeech(current);
  if (previous.dialogueUnitId && previous.dialogueUnitId === current.dialogueUnitId
    && (previousSpeech.length || currentSpeech.length)) return 'dialogue-reverse';
  if (previous.clipType === 'action' && current.clipType === 'reaction') return 'action-reaction';
  if (current.clipType === 'insert') return 'detail-insert';
  if (previous.clipType === 'insert' && ['action', 'reaction', 'dialogue', 'performance'].includes(current.clipType || '')) return 'insert-return';
  if (previous.clipType === 'establishing' && current.clipType !== 'establishing') return 'establish-develop';
  if (previous.clipType === 'montage' && current.clipType === 'montage') return 'rhythmic-montage';
  if (isExplicitEditorialBridge(previous, current)) return 'match-continuity';

  const previousScale = framingScale(previous);
  const currentScale = framingScale(current);
  if (previousScale !== undefined && currentScale !== undefined
    && previousScale >= 4 && currentScale <= 3) return 'progressive-coverage';

  const sequenceChanged = Boolean(previous.sequenceId && current.sequenceId && previous.sequenceId !== current.sequenceId);
  const locationChanged = Boolean(previous.locationId && current.locationId && previous.locationId !== current.locationId);
  if (sequenceChanged || locationChanged) return 'motivated-transition';
  return 'direct-cut';
}

function isProtectedHeroShot(storyboard: Storyboard, index: number, total: number): boolean {
  if (storyboard.clipType === 'long_take') return true;
  const closeFraming = (framingScale(storyboard) ?? 5) <= 1;
  const role = normalizedEditorialText(storyboard);
  if (storyboard.clipType === 'performance' && (closeFraming || estimateStoryboardVisualSeconds(storyboard) >= 6.5)) return true;
  if (storyboard.clipType === 'dialogue' && Number(storyboard.durationHint || storyboard.videoDuration || 0) >= 10) return true;
  return index === total - 1 && closeFraming && /payoff|resolution|climax|final|兑现|收束|高潮|结局/.test(role);
}

function hasHardEditorialBoundary(previous: Storyboard, current: Storyboard): boolean {
  if (previous.transition && previous.transition !== 'cut') return true;
  const sequenceChanged = Boolean(previous.sequenceId && current.sequenceId && previous.sequenceId !== current.sequenceId);
  const locationChanged = Boolean(previous.locationId && current.locationId && previous.locationId !== current.locationId);
  if (!(sequenceChanged || locationChanged)) return false;
  return !isExplicitEditorialBridge(previous, current)
    && previous.clipType !== 'montage'
    && current.clipType !== 'montage';
}

function cinematicPairScore(previous: Storyboard, current: Storyboard): number {
  if (hasHardEditorialBoundary(previous, current)) return Number.NEGATIVE_INFINITY;
  const relationScore: Record<CinematicEditKind, number> = {
    'dialogue-reverse': 13,
    'action-reaction': 12,
    'detail-insert': 10,
    'insert-return': 8,
    'establish-develop': 10,
    'rhythmic-montage': 10,
    'match-continuity': 8,
    'progressive-coverage': 7,
    'motivated-transition': 5,
    'direct-cut': 0,
  };
  let score = relationScore[cinematicEditKind(previous, current)];
  const previousRole = normalizedEditorialText(previous);
  const currentRole = normalizedEditorialText(current);
  if (/setup|opening|establish|铺垫|建立/.test(previousRole)
    && /development|escalation|contrast|发展|升级|对照/.test(currentRole)) score += 5;
  if (/development|escalation|contrast|decision|发展|升级|对照|决定/.test(previousRole)
    && /decision|consequence|payoff|resolution|决定|后果|兑现|收束/.test(currentRole)) score += 5;
  if (previous.editBridge) score += 2;
  if (hasSharedValue(previous.characters, current.characters)) score += 1;
  if (hasSharedValue(previous.objects, current.objects)) score += 1;
  if ((!previous.sequenceId || !current.sequenceId || previous.sequenceId === current.sequenceId)
    && (!previous.locationId || !current.locationId || previous.locationId === current.locationId)) score += 1;
  const previousScale = framingScale(previous);
  const currentScale = framingScale(current);
  if (previousScale !== undefined && currentScale !== undefined && previousScale !== currentScale) score += 1;
  return score;
}

function isViableCinematicGroup(
  group: Storyboard[],
  startIndex: number,
  total: number,
): { score: number } | undefined {
  if (!group.length || group.length > MAX_H3_STORYBOARDS_PER_SEGMENT) return undefined;
  if (!areContiguousStoryboards(group) || estimateVideoSegmentSeconds(group) > MAX_H3_SEGMENT_SECONDS) return undefined;
  if (validateSpeechContract(group)) return undefined;
  if (group.length === 1) return { score: 0 };
  if (group.some((storyboard, offset) => isProtectedHeroShot(storyboard, startIndex + offset, total))) return undefined;

  const pairScores = group.slice(1).map((storyboard, offset) => cinematicPairScore(group[offset], storyboard));
  if (pairScores.some(score => !Number.isFinite(score) || score < 4)) return undefined;
  // One clearly motivated edit must anchor the sequence. This prevents a run
  // of merely adjacent coverage from being compressed into Ref2VA.
  if (!pairScores.some(score => score >= 7)) return undefined;
  const lengthPenalty = group.length === 4 ? 1.5 : 0;
  return { score: pairScores.reduce((sum, score) => sum + score, 0) - lengthPenalty };
}

export function suggestVideoSegments(storyboards: Storyboard[]): Storyboard[][] {
  // Dynamic programming retains a storyboard as a discrete I2VA hero shot by
  // default and chooses Ref2VA only when consecutive pictures form a genuine
  // editorial unit: coverage progression, action/reaction, shot/reverse-shot,
  // detail insert, montage, or an explicit match bridge.
  const best: Array<{ score: number; groups: Storyboard[][] }> = Array(storyboards.length + 1);
  best[storyboards.length] = { score: 0, groups: [] };
  for (let index = storyboards.length - 1; index >= 0; index -= 1) {
    let winner = { score: best[index + 1].score, groups: [[storyboards[index]], ...best[index + 1].groups] };
    const maxLength = Math.min(MAX_H3_STORYBOARDS_PER_SEGMENT, storyboards.length - index);
    for (let length = 2; length <= maxLength; length += 1) {
      const group = storyboards.slice(index, index + length);
      const candidate = isViableCinematicGroup(group, index, storyboards.length);
      if (!candidate) continue;
      const tail = best[index + length];
      const score = candidate.score + tail.score;
      // Prefer the longer complete editorial phrase only when its score is not
      // worse; deterministic ties avoid plans changing between refreshes.
      if (score >= winner.score) winner = { score, groups: [group, ...tail.groups] };
    }
    best[index] = winner;
  }
  return best[0]?.groups || [];
}

export function createVideoSegmentPlan(
  storyboards: Storyboard[],
  groups: Storyboard[][],
  source: VideoSegmentPlan['source'] = 'auto',
): VideoSegmentPlan {
  const segments = groups.filter(group => group.length).map((group, index) => {
    const storyboardIds = group.map(storyboard => storyboard.id);
    return {
      id: segmentId(storyboardIds, index),
      storyboardIds,
      speech: authorSegmentSpeech(group),
    };
  });
  return {
    version: 2,
    source,
    planningContract: VIDEO_SEGMENT_PLANNING_CONTRACT,
    segments,
    groups: segments.map(segment => segment.storyboardIds),
    storyboardSignature: storyboardSignature(storyboards),
    updatedAt: new Date().toISOString(),
  };
}

export function isValidVideoSegmentPlan(
  plan: VideoSegmentPlan | undefined,
  storyboards: Storyboard[],
  language?: 'zh' | 'en',
): plan is VideoSegmentPlan {
  if (!plan || plan.version !== 2 || !Array.isArray(plan.segments) || !plan.segments.length) return false;
  if (plan.source === 'auto' && plan.planningContract !== VIDEO_SEGMENT_PLANNING_CONTRACT) return false;
  if (plan.storyboardSignature !== storyboardSignature(storyboards)) return false;
  const ids = plan.segments.flatMap(segment => segment.storyboardIds || []);
  if (ids.join('|') !== storyboardSignature(storyboards)) return false;
  if (new Set(ids).size !== ids.length) return false;
  const byId = new Map(storyboards.map(storyboard => [storyboard.id, storyboard]));
  return plan.segments.every(segment => {
    if (!segment.id || !Array.isArray(segment.storyboardIds) || !Array.isArray(segment.speech)) return false;
    const group = segment.storyboardIds.map(id => byId.get(id)).filter((item): item is Storyboard => Boolean(item));
    const materialized = materializeSegmentStoryboards(group, segment);
    return group.length === segment.storyboardIds.length
      && estimateVideoSegmentSeconds(materialized) <= MAX_H3_SEGMENT_SECONDS
      && !validateVideoSegment(materialized, language);
  });
}

/**
 * Upgrade v1/legacy grouping or rebuild a stale plan once. The returned v2
 * plan freezes segment-level dialogue before any H3 prompt is produced.
 */
export function normalizeVideoSegmentPlan(
  storyboards: Storyboard[],
  plan?: VideoSegmentPlan | { version?: number; source?: 'auto' | 'manual'; planningContract?: string; groups?: string[][] },
  language?: 'zh' | 'en',
): VideoSegmentPlan {
  if (isValidVideoSegmentPlan(plan as VideoSegmentPlan, storyboards, language)) return plan as VideoSegmentPlan;
  const byId = new Map(storyboards.map(storyboard => [storyboard.id, storyboard]));
  const legacyGroups = Array.isArray(plan?.groups)
    ? plan.groups.map(ids => ids.map(id => byId.get(id)).filter((item): item is Storyboard => Boolean(item)))
    : [];
  const legacyIds = legacyGroups.flat().map(storyboard => storyboard.id);
  const canReuseLegacyBoundaries = (plan?.source === 'manual' || plan?.planningContract === VIDEO_SEGMENT_PLANNING_CONTRACT)
    && legacyGroups.length > 0
    && legacyIds.join('|') === storyboardSignature(storyboards)
    && new Set(legacyIds).size === storyboards.length
    && legacyGroups.every(group => group.length && !validateVideoSegment(group, language));
  return createVideoSegmentPlan(
    storyboards,
    canReuseLegacyBoundaries ? legacyGroups : suggestVideoSegments(storyboards),
    plan?.source === 'manual' && canReuseLegacyBoundaries ? 'manual' : 'auto',
  );
}

export function resolveVideoSegmentGroups(
  storyboards: Storyboard[],
  plan?: VideoSegmentPlan,
  language?: 'zh' | 'en',
): Storyboard[][] {
  if (!storyboards.length) return [];
  const normalized = normalizeVideoSegmentPlan(storyboards, plan, language);
  const byId = new Map(storyboards.map(storyboard => [storyboard.id, storyboard]));
  return normalized.segments.map(segment => materializeSegmentStoryboards(
    segment.storyboardIds.map(id => byId.get(id)!),
    segment,
  ));
}

/** Refresh media/job state without replacing the segment's authoritative speech. */
export function refreshPlannedVideoSegment(storyboards: Storyboard[], planned: Storyboard[]): Storyboard[] {
  const byId = new Map(storyboards.map(item => [item.id, item]));
  return planned.map(item => ({
    ...item,
    ...(byId.get(item.id) || {}),
    speech: item.speech,
    dialogueLines: item.dialogueLines,
    dialogue: item.dialogue,
  }));
}

function equivalentSegmentSpeech(first: Storyboard[], second: Storyboard[]): boolean {
  try {
    return JSON.stringify(authorSegmentSpeech(first)) === JSON.stringify(authorSegmentSpeech(second));
  } catch {
    return false;
  }
}

/** Both manual and automatic production check the same planned creative input. */
export function isCompletedPlannedVideoSegment(storyboards: Storyboard[], planned: Storyboard[]): boolean {
  const current = refreshPlannedVideoSegment(storyboards, planned);
  if (isCompletedVideoSegment(current)) return true;
  const raw = planned.map(item => storyboards.find(candidate => candidate.id === item.id) || item);
  // Old automatic jobs hashed the raw per-shot speech. Reuse only when it
  // compiles to the very same segment speech; an edited plan is never ignored.
  return equivalentSegmentSpeech(raw, current) && isCompletedVideoSegment(raw);
}

function hasMatchingVideoGeneration(storyboards: Storyboard[]): boolean {
  const leader = storyboards[0];
  if (!leader || hasLegacyAutomaticContinuity(leader)) return false;
  const saved = leader.videoGenerationSignature;
  if (!saved) return true;
  const current = videoSegmentGenerationSignature(storyboards);
  if (saved === current) return true;
  // Preserve paid v33 clips that already started from their own storyboard
  // and whose creative inputs are unchanged. Do not rewrite their provenance.
  return !leader.continuousFromPrev && leader.videoStartMode !== 'previous-segment-tail'
    && saved.startsWith('h3-v33-') && saved.slice(7) === current.slice(7);
}

export function isCompletedVideoSegment(storyboards: Storyboard[]): boolean {
  const leader = storyboards[0];
  if (!leader || !leader.videoUrl || !leader.videoSegmentId) return false;
  if (!hasMatchingVideoGeneration(storyboards)) return false;
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
  if (!hasMatchingVideoGeneration(storyboards)) return false;
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
  // A project rendered before fidelity-first auto segmentation may contain
  // paid multi-shot artifacts and no separately persisted plan. Continue to
  // recognize those exact saved segment memberships instead of invalidating
  // finished work merely because new projects now default to one shot each.
  const historicalGroups: Storyboard[][] = [];
  const seenHistoricalSegments = new Set<string>();
  for (const storyboard of storyboards) {
    const id = String(storyboard.videoSegmentId || '');
    if (!id || seenHistoricalSegments.has(id)) continue;
    seenHistoricalSegments.add(id);
    const leader = storyboards.find(candidate => candidate.videoSegmentId === id && candidate.videoSegmentStoryboardIds?.length);
    const byId = new Map(storyboards.map(candidate => [candidate.id, candidate]));
    const members = (leader?.videoSegmentStoryboardIds || []).map(memberId => byId.get(memberId)).filter((item): item is Storyboard => Boolean(item));
    if (members.length) historicalGroups.push(members);
  }
  if (!plan && historicalGroups.length && historicalGroups.flat().length === storyboards.length
    && historicalGroups.every(isPersistedVideoSegment)) return 6;
  const groups = resolveVideoSegmentGroups(storyboards, plan);
  return groups.length > 0 && groups.every(group => {
    if (isPersistedVideoSegment(group)) return true;
    const raw = group.map(item => storyboards.find(candidate => candidate.id === item.id) || item);
    return equivalentSegmentSpeech(raw, group) && isPersistedVideoSegment(raw);
  }) ? 6 : 5;
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
