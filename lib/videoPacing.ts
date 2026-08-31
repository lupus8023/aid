import type { Storyboard } from '@/types';
import { allocateSegmentTimeline } from './videoSegments';
import { FILM_ENDING_SECONDS } from './filmEnding';

export type PacingMode = 'original' | 'cinematic' | 'standard' | 'compact';
export type PacingKind = 'original' | 'emotion' | 'dialogue' | 'narrative' | 'transition' | 'action';

export interface PacingSection {
  sourceStart: number;
  sourceEnd: number;
  rate: number;
  kind: PacingKind;
  reason: string;
}

export interface PaceableClip {
  duration: number;
  trimStart: number;
  trimEnd: number;
  pacingSections?: PacingSection[];
  /** Derived from film order; does not alter the authored pacing sections. */
  preserveEndingSeconds?: number;
}

export const DEFAULT_PACING_MODE: PacingMode = 'standard';

export const PACING_MODE_LABELS: Record<PacingMode, string> = {
  original: '原速',
  cinematic: '电影',
  standard: '智能标准',
  compact: '紧凑',
};

const RATE_PROFILES: Record<PacingMode, Record<PacingKind, number>> = {
  original: { original: 1, emotion: 1, dialogue: 1, narrative: 1, transition: 1, action: 1 },
  cinematic: { original: 1, emotion: 1, dialogue: 1.04, narrative: 1.08, transition: 1.12, action: 1.12 },
  standard: { original: 1, emotion: 1.02, dialogue: 1.08, narrative: 1.16, transition: 1.22, action: 1.22 },
  compact: { original: 1, emotion: 1.05, dialogue: 1.12, narrative: 1.22, transition: 1.28, action: 1.28 },
};

const EMOTION_TERMS = /凝视|落泪|眼泪|迟疑|犹豫|哽咽|悲伤|压抑|克制|沉默|停顿|呼吸|震惊|恐惧|绝望|告别|吻|拥抱|揭示|真相|高潮|结局|收束|payoff|resolution|climax|reveal|tear|cry|grief|hesitat|pause|silence|breath|shock|fear|despair|farewell|kiss|embrace|restrained|close emotional/i;
const ACTION_TERMS = /奔跑|追逐|冲刺|跳跃|打斗|战斗|爆炸|坠落|飞行|游动|逃离|撞击|快速|急促|run|chase|sprint|jump|fight|battle|explode|fall|fly|swim|escape|impact|rapid|fast/i;
const CLOSE_SHOT_TERMS = /大特写|特写|近景|extreme close|close[- ]?up|medium close/i;

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function storyboardText(storyboard: Storyboard): string {
  return [
    storyboard.clipType,
    storyboard.shotSize,
    storyboard.action,
    storyboard.description,
    storyboard.dramaticPurpose,
    storyboard.montageRole,
    storyboard.dialoguePurpose,
    ...(storyboard.performance || []).flatMap(cue => [
      cue.objective,
      cue.blocking,
      cue.gesture,
      cue.expression,
      cue.gaze,
      cue.breath,
      cue.reaction,
      cue.subtext,
    ]),
  ].map(clean).filter(Boolean).join(' ');
}

function hasDialogue(storyboard: Storyboard): boolean {
  if (Array.isArray(storyboard.speech)) return storyboard.speech.some(line => clean(line.exactLine));
  if (storyboard.dialogueLines?.some(line => clean(line.text))) return true;
  return Object.values(storyboard.dialogue || {}).some(clean);
}

export function classifyStoryboardPacing(storyboard: Storyboard): { kind: PacingKind; reason: string } {
  const text = storyboardText(storyboard);
  const closeShot = CLOSE_SHOT_TERMS.test(`${storyboard.shotSize || ''} ${storyboard.angle || ''}`);
  const emotionalBeat = EMOTION_TERMS.test(text);

  if (storyboard.clipType === 'long_take') {
    return { kind: 'emotion', reason: '长镜头保护' };
  }
  if (emotionalBeat && (closeShot || storyboard.clipType === 'performance' || storyboard.clipType === 'reaction')) {
    return { kind: 'emotion', reason: '关键情绪与表演停顿保护' };
  }
  if (hasDialogue(storyboard) || storyboard.clipType === 'dialogue') {
    return { kind: 'dialogue', reason: '对白与口型可读性保护' };
  }
  if (storyboard.clipType === 'action' || ACTION_TERMS.test(text)) {
    return { kind: 'action', reason: '动作镜头提速' };
  }
  if (storyboard.clipType === 'establishing' || storyboard.clipType === 'insert' || storyboard.clipType === 'montage') {
    return { kind: 'transition', reason: '建立、细节或蒙太奇镜头压缩' };
  }
  if (emotionalBeat) {
    return { kind: 'emotion', reason: '叙事情绪停顿保护' };
  }
  return { kind: 'narrative', reason: '常规叙事节奏优化' };
}

export function storyboardPacingRate(storyboard: Storyboard, mode: PacingMode): number {
  if (mode === 'original') return 1;
  const { kind } = classifyStoryboardPacing(storyboard);
  return RATE_PROFILES[mode][kind];
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safeRate(value: unknown): number {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 1;
  return Math.min(1.5, Math.max(0.8, Math.round(rate * 100) / 100));
}

function mergeAdjacentSections(sections: PacingSection[]): PacingSection[] {
  return sections.reduce<PacingSection[]>((result, section) => {
    const previous = result.at(-1);
    if (previous
      && Math.abs(previous.sourceEnd - section.sourceStart) < 0.002
      && previous.rate === section.rate
      && previous.kind === section.kind) {
      previous.sourceEnd = section.sourceEnd;
      return result;
    }
    result.push({ ...section });
    return result;
  }, []);
}

export function buildSmartPacingSections(
  storyboards: Storyboard[],
  sourceDuration: number,
  mode: PacingMode = DEFAULT_PACING_MODE,
): PacingSection[] {
  const duration = Math.max(0, Number(sourceDuration) || 0);
  if (!duration) return [];
  if (!storyboards.length || mode === 'original') {
    return [{ sourceStart: 0, sourceEnd: rounded(duration), rate: 1, kind: 'original', reason: '保留原始速度' }];
  }

  const timeline = allocateSegmentTimeline(storyboards, duration);
  return mergeAdjacentSections(storyboards.map((storyboard, index) => {
    const classification = classifyStoryboardPacing(storyboard);
    return {
      sourceStart: rounded(timeline[index]?.start || 0),
      sourceEnd: rounded(timeline[index]?.end ?? duration),
      rate: storyboardPacingRate(storyboard, mode),
      kind: classification.kind,
      reason: classification.reason,
    };
  }).filter(section => section.sourceEnd - section.sourceStart >= 0.01));
}

export function clippedPacingSections(clip: PaceableClip): PacingSection[] {
  const sourceStart = Math.max(0, Number(clip.trimStart) || 0);
  const sourceEnd = Math.max(sourceStart, (Number(clip.duration) || 0) - Math.max(0, Number(clip.trimEnd) || 0));
  if (sourceEnd - sourceStart < 0.001) return [];

  const planned = (clip.pacingSections || [])
    .map(section => ({
      sourceStart: Math.max(sourceStart, Number(section.sourceStart) || 0),
      sourceEnd: Math.min(sourceEnd, Number(section.sourceEnd) || 0),
      rate: safeRate(section.rate),
      kind: section.kind || 'narrative',
      reason: clean(section.reason) || '智能节奏优化',
    }))
    .filter(section => section.sourceEnd - section.sourceStart >= 0.01)
    .sort((left, right) => left.sourceStart - right.sourceStart);

  if (!planned.length) {
    return [{ sourceStart, sourceEnd, rate: 1, kind: 'original', reason: '保留原始速度' }];
  }

  const complete: PacingSection[] = [];
  let cursor = sourceStart;
  for (const section of planned) {
    if (section.sourceStart > cursor + 0.002) {
      complete.push({ sourceStart: cursor, sourceEnd: section.sourceStart, rate: 1, kind: 'original', reason: '未规划区间保持原速' });
    }
    const start = Math.max(cursor, section.sourceStart);
    if (section.sourceEnd > start + 0.002) complete.push({ ...section, sourceStart: start });
    cursor = Math.max(cursor, section.sourceEnd);
  }
  if (cursor < sourceEnd - 0.002) {
    complete.push({ sourceStart: cursor, sourceEnd, rate: 1, kind: 'original', reason: '未规划区间保持原速' });
  }
  const protectedStart = Math.max(sourceStart, sourceEnd - Math.max(0, Number(clip.preserveEndingSeconds) || 0));
  return mergeAdjacentSections(complete.flatMap(section => {
    if (section.sourceEnd <= protectedStart || section.rate <= 1) return [section];
    const tail = { ...section, sourceStart: Math.max(section.sourceStart, protectedStart), rate: 1, reason: '整片末镜结尾保持原速' };
    return section.sourceStart < protectedStart
      ? [{ ...section, sourceEnd: protectedStart }, tail]
      : [tail];
  }));
}

/** Re-evaluate on reorder, without leaving protection on the previous last clip. */
export function withFilmEndingPacing<T extends PaceableClip>(clips: T[]): T[] {
  return clips.map((clip, index) => ({ ...clip, preserveEndingSeconds: index === clips.length - 1 ? FILM_ENDING_SECONDS : 0 }));
}

export function effectiveClipDuration(clip: PaceableClip): number {
  return clippedPacingSections(clip).reduce(
    (total, section) => total + (section.sourceEnd - section.sourceStart) / section.rate,
    0,
  );
}

export function averagePacingRate(clip: PaceableClip): number {
  const sourceDuration = Math.max(0, clip.duration - clip.trimStart - clip.trimEnd);
  const outputDuration = effectiveClipDuration(clip);
  return outputDuration > 0 ? sourceDuration / outputDuration : 1;
}

export function sourceTimeForOutputOffset(clip: PaceableClip, outputOffset: number): number {
  const sections = clippedPacingSections(clip);
  if (!sections.length) return Math.max(0, clip.trimStart);
  let remaining = Math.max(0, outputOffset);
  for (const section of sections) {
    const outputDuration = (section.sourceEnd - section.sourceStart) / section.rate;
    if (remaining <= outputDuration) return Math.min(section.sourceEnd, section.sourceStart + remaining * section.rate);
    remaining -= outputDuration;
  }
  return sections.at(-1)!.sourceEnd;
}

export function outputOffsetForSourceTime(clip: PaceableClip, sourceTime: number): number {
  const sections = clippedPacingSections(clip);
  const target = Number(sourceTime) || 0;
  let output = 0;
  for (const section of sections) {
    if (target <= section.sourceStart) return output;
    const consumed = Math.min(section.sourceEnd, target) - section.sourceStart;
    output += Math.max(0, consumed) / section.rate;
    if (target <= section.sourceEnd) return output;
  }
  return output;
}

export function playbackRateAtSourceTime(clip: PaceableClip, sourceTime: number): number {
  const sections = clippedPacingSections(clip);
  return sections.find(section => sourceTime >= section.sourceStart - 0.002 && sourceTime < section.sourceEnd - 0.002)?.rate
    || sections.at(-1)?.rate
    || 1;
}
