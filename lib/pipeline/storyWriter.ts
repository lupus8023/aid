import type { StoryPlan, Beat, PlannedCharacter, StoryRequirement, WriterCharacter, WriterObject } from './types';
import { buildSourceShotAdaptationMap, buildStoryBeatBatchPrompt, buildStoryOutlinePrompt } from './storyWriterPrompt';
import { chatOnce, type ScriptProvider } from './llm';
import { extractJson } from './json';
import { normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from './shotCount';
import type { NarrativeState, StoryAudioPlan, Storyboard, StoryClipType, StorySpeechLine } from '@/types';
import { generatedSpeakerMatchesVisibleAction, isDirectingInstructionDialogue, sanitizeGeneratedSpeechText, speechSeconds } from '@/lib/speechAudioContract';
import { castStoryVoices, resolveGeneratedStoryIdentity } from '@/lib/voiceCasting';
import type { VoiceAgeGroup, VoiceGender } from '@/types';

const TRANSITIONS: Beat['transition'][] = ['cut', 'dissolve', 'fade', 'wipe'];
const REQUIREMENT_CATEGORIES: StoryRequirement['category'][] = ['plot', 'character', 'setting', 'tone', 'format', 'pacing', 'dialogue', 'visual', 'avoid', 'other'];
const CLIP_TYPES: StoryClipType[] = ['insert', 'reaction', 'establishing', 'action', 'dialogue', 'performance', 'montage', 'long_take'];
const VOLUMES: StorySpeechLine['volume'][] = ['whisper', 'soft', 'normal', 'raised'];

const NON_CHARACTER_SPEAKERS = new Set([
  'none', 'n/a', 'no dialogue', 'narrator', 'voice-over', 'voiceover',
  '无', '无台词', '旁白', '画外音',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function explicitDialogueSpeakers(synopsis: string): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  const dialogueLines = String(synopsis || '').split(/\r?\n/).filter(line => /(?:dialogue|台词)\s*[:：]/iu.test(line));
  const speakerPattern = /([A-Za-z][A-Za-z'’.\-]*(?:\s+[A-Za-z][A-Za-z'’.\-]*){0,4}|[\p{Script=Han}]{1,8})\s*[:：]\s*[“"']/gu;
  for (const line of dialogueLines) {
    for (const match of line.matchAll(speakerPattern)) {
      const name = String(match[1] || '').trim();
      if (!name || NON_CHARACTER_SPEAKERS.has(name.toLocaleLowerCase())) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function expandStoryCharacters(
  synopsis: string,
  uploadedCharacters: WriterCharacter[],
  language: 'zh' | 'en' = 'zh',
): { characters: WriterCharacter[]; canonicalSynopsis: string; aliases: Record<string, string> } {
  const speakers = explicitDialogueSpeakers(synopsis);
  const aliases: Record<string, string> = {};
  const uploadedByName = new Map(uploadedCharacters.map(character => [character.name.toLocaleLowerCase(), character]));
  const remaining = speakers.filter(speaker => !uploadedByName.has(speaker.name.toLocaleLowerCase()));

  // Detailed scripts often name the sole uploaded protagonist in prose while
  // its character card uses a translated role label. In that one-card case,
  // the most frequent speaking identity is the deterministic protagonist
  // alias; supporting roles remain separate text-defined identities.
  if (uploadedCharacters.length === 1 && remaining.length) {
    aliases[remaining[0].name] = uploadedCharacters[0].name;
  }

  let canonicalSynopsis = String(synopsis || '');
  for (const [alias, canonical] of Object.entries(aliases)) {
    // Canonicalize identity references and speaker labels, but never rewrite
    // the words inside quoted dialogue.  A global replacement used to turn
    // e.g. `“Princess Lanxi…”` into `“Princess 人鱼公主…”`; the later exact-line
    // guard correctly rejected that mutated quote, silently deleting the
    // corresponding speech line from the finished storyboard.
    const aliasPattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'giu');
    canonicalSynopsis = canonicalSynopsis
      .split(/([“"][^”"]*[”"])/gu)
      .map((part, index) => index % 2 === 1 ? part : part.replace(aliasPattern, canonical))
      .join('');
  }

  const textDefinedCharacters: WriterCharacter[] = remaining
    .filter(speaker => !aliases[speaker.name])
    .map(speaker => ({
      name: speaker.name,
      description: 'Text-defined supporting story identity explicitly named by the user. Keep one stable role-appropriate face, body, age, silhouette, wardrobe and color palette across every appearance; no separate reference image is supplied.',
    }));

  return {
    characters: castStoryVoices([...uploadedCharacters, ...textDefinedCharacters], language),
    canonicalSynopsis,
    aliases,
  };
}

export interface StoryOutlineBeat {
  index: number;
  sourceShotRefs: number[];
  actionGoal: string;
  cause: string;
  consequence: string;
  emotionalTurn: string;
  informationGain: string;
  dialoguePurpose: string;
  dialogueUnitId: string;
  dialogueObligation: 'required' | 'optional' | 'visual';
  dialogueContext: string;
  dialogueTurns: StoryOutlineDialogueTurn[];
  montageRole: string;
  audienceQuestion: string;
  requiredSpeaker: string;
  requiredLine: string;
  requiredDialogueLines: Array<{ character: string; text: string }>;
}

export interface StoryOutlineDialogueTurn {
  speaker: string;
  function: string;
  contentGoal: string;
  respondsTo: string;
}

export interface StoryOutlineSequence {
  id: string;
  locationId: string;
  sceneGoal: string;
  dramaticQuestion: string;
  turningPoint: string;
  exitHook: string;
  audienceEntry: string;
  audienceExit: string;
  entryState: string;
  exitState: string;
  shotCount: number;
  beatMap: StoryOutlineBeat[];
}

export interface StoryOutline extends Record<string, unknown> {
  sequences: StoryOutlineSequence[];
}

export interface StoryBeatBatch {
  sequence: StoryOutlineSequence;
  beatMap: StoryOutlineBeat[];
  batchNumber: number;
}

export function parseSourceDialogueByShot(
  synopsis: string,
  allowedCharacters: string[],
): Map<number, Array<{ character: string; text: string }>> {
  const result = new Map<number, Array<{ character: string; text: string }>>();
  const speakerPattern = /([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,4}|[\p{Script=Han}]{1,12})\s*[:：]\s*[“"]([^”"]+)[”"]/gu;
  for (const sourceLine of String(synopsis || '').split(/\r?\n/)) {
    const shotMatch = sourceLine.match(/(?:SHOT|镜头)\s*0*(\d+)\b/iu);
    const dialogueMarker = sourceLine.match(/(?:dialogue|台词)\s*[:：]/iu);
    if (!shotMatch || !dialogueMarker) continue;
    const shotIndex = Number(shotMatch[1]);
    const dialogueText = sourceLine.slice((dialogueMarker.index || 0) + dialogueMarker[0].length);
    const lines: Array<{ character: string; text: string }> = [];
    for (const match of dialogueText.matchAll(speakerPattern)) {
      const character = String(match[1] || '').trim();
      const text = String(match[2] || '').replace(/\s+/g, ' ').trim();
      if (!character || !text || NON_CHARACTER_SPEAKERS.has(character.toLocaleLowerCase())) continue;
      if (!allowedCharacters.includes(character)) continue;
      lines.push({ character, text });
    }
    if (lines.length) result.set(shotIndex, lines);
  }
  return result;
}

export function applySourceDialogueAuthority(
  outline: StoryOutline,
  synopsis: string,
  allowedCharacters: string[],
): StoryOutline {
  const sourceDialogue = parseSourceDialogueByShot(synopsis, allowedCharacters);
  const targetBeatCount = outline.sequences.reduce((total, sequence) => total + sequence.beatMap.length, 0);
  const sourceShotIndexes = [...String(synopsis || '').matchAll(/(?:SHOT|镜头)\s*0*(\d+)\b/giu)]
    .map(match => Number(match[1]))
    .filter(Number.isFinite);
  const sourceShotCount = sourceShotIndexes.length ? Math.max(...sourceShotIndexes) : targetBeatCount;
  const adaptationByTarget = new Map(
    buildSourceShotAdaptationMap(synopsis, targetBeatCount).map(group => [group.targetIndex, group] as const),
  );
  const sourceByKey = new Map<string, { character: string; text: string }>(
    [...sourceDialogue.values()].flat().map(line => [`${line.character}\u0000${line.text}`, line] as const),
  );
  outline.sequences.forEach(sequence => {
    sequence.beatMap.forEach(beat => {
      let lines: Array<{ character: string; text: string }> | undefined;
      if (sourceShotCount === targetBeatCount) {
        lines = sourceDialogue.get(beat.index);
        beat.sourceShotRefs = [beat.index];
      } else if (adaptationByTarget.size) {
        const group = adaptationByTarget.get(beat.index);
        beat.sourceShotRefs = group?.sourceShotRefs || [];
        lines = beat.sourceShotRefs.flatMap(sourceIndex => sourceDialogue.get(sourceIndex) || []);
      } else {
        // Expanding a short source needs authored beats rather than mechanical
        // compression. Match exact source lines only where the outline placed
        // their semantic content.
        const planned = [
          ...(beat.requiredDialogueLines || []),
          ...(beat.requiredLine && beat.requiredSpeaker
            ? [{ character: beat.requiredSpeaker, text: beat.requiredLine }]
            : []),
          ...(beat.dialogueTurns || []).map(turn => ({ character: turn.speaker, text: turn.contentGoal })),
        ];
        const seen = new Set<string>();
        lines = planned.map(line => {
          const key = `${line.character}\u0000${line.text}`;
          if (seen.has(key)) return undefined;
          seen.add(key);
          return sourceByKey.get(key);
        }).filter((line): line is { character: string; text: string } => Boolean(line));
      }
      if (!lines) return;
      if (!lines.length) return;
      beat.requiredDialogueLines = lines;
      beat.requiredSpeaker = lines[0].character;
      beat.requiredLine = lines[0].text;
      beat.dialogueTurns = lines.map((line, index) => ({
        speaker: line.character,
        function: index === 0 ? 'user_exact' : 'answer',
        contentGoal: line.text,
        respondsTo: index === 0 ? '' : lines[index - 1].text,
      }));
      if (/(?:visual_only|纯视觉|无对白)/i.test(beat.dialoguePurpose)) {
        beat.dialoguePurpose = lines.length > 1 ? 'exchange' : 'story_progression';
      }
    });
  });
  return outline;
}

export function missingSourceDialogueLines(
  outline: StoryOutline,
  synopsis: string,
  allowedCharacters: string[],
): Array<{ character: string; text: string }> {
  const required = [...parseSourceDialogueByShot(synopsis, allowedCharacters).values()].flat();
  const availableCounts = new Map<string, number>();
  for (const beat of outline.sequences.flatMap(sequence => sequence.beatMap)) {
    for (const line of beat.requiredDialogueLines || []) {
      const key = `${line.character}\u0000${line.text}`;
      availableCounts.set(key, (availableCounts.get(key) || 0) + 1);
    }
  }
  return required.filter(line => {
    const key = `${line.character}\u0000${line.text}`;
    const count = availableCounts.get(key) || 0;
    if (!count) return true;
    availableCounts.set(key, count - 1);
    return false;
  });
}

export function normalizedBeatConflict(
  value: unknown,
  authority: Pick<StoryOutlineBeat, 'index' | 'montageRole' | 'emotionalTurn'>,
  targetShotCount: number,
  language: 'zh' | 'en',
): string {
  const submitted = asString(value).trim();
  if (submitted) return submitted;
  const isResolution = authority.index === targetShotCount
    || /(?:resolution|payoff|epilogue|收束|结局|回收)/i.test(authority.montageRole);
  if (!isResolution) return '';
  const residue = authority.emotionalTurn.trim();
  return language === 'en'
    ? `The central conflict is resolved; the remaining tension is whether the new state holds${residue ? ` as ${residue}` : ''}.`
    : `核心冲突已经解决；本镜仅保留新状态能否成立的余波${residue ? `：${residue}` : ''}。`;
}

export function normalizedBeatNextCause(
  value: unknown,
  authority: Pick<StoryOutlineBeat, 'index' | 'montageRole' | 'consequence'>,
  targetShotCount: number,
  language: 'zh' | 'en',
): string {
  const submitted = asString(value).trim();
  if (submitted) return submitted;
  const isEnding = authority.index === targetShotCount
    || /(?:resolution|epilogue|结局|收束)/i.test(authority.montageRole);
  if (!isEnding) return '';
  return language === 'en'
    ? `Terminal story state: ${authority.consequence || 'the resolved new state continues'}; no later plot beat follows.`
    : `终局状态：${authority.consequence || '冲突解决后的新状态持续'}；不再触发后续剧情镜。`;
}

function unwrapStoryOutline(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4 || !value) return {};
  if (Array.isArray(value)) {
    if (value.length === 1) return unwrapStoryOutline(value[0], depth + 1);
    return {};
  }
  if (typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.sequences)) return record;
  for (const key of ['storyPlan', 'storyOutline', 'outline', 'plan', 'story', 'result', 'output', 'data']) {
    const nested = unwrapStoryOutline(record[key], depth + 1);
    if (Array.isArray(nested.sequences)) return nested;
  }
  return {};
}

function validTransition(value: unknown): Beat['transition'] {
  const s = String(value || '');
  return (TRANSITIONS as string[]).includes(s) ? (s as Beat['transition']) : 'cut';
}

function clampDuration(value: unknown, fallback = 5): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(15, Math.max(2, Math.round(n * 2) / 2)); // 0.5s 精度，2-15s
}

function filterNames(list: unknown, allowed: string[]): string[] {
  if (!Array.isArray(list)) return [];
  return list.map(String).filter(name => allowed.includes(name));
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function voiceGender(value: unknown): VoiceGender {
  const normalized = asString(value).trim().toLowerCase();
  return (['female', 'male', 'nonbinary', 'unknown'] as const).includes(normalized as VoiceGender)
    ? normalized as VoiceGender
    : 'unknown';
}

function voiceAgeGroup(value: unknown): VoiceAgeGroup {
  const normalized = asString(value).trim().toLowerCase();
  return (['child', 'young_adult', 'adult', 'senior', 'unknown'] as const).includes(normalized as VoiceAgeGroup)
    ? normalized as VoiceAgeGroup
    : 'unknown';
}

function stringList(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => asString(item).trim()).filter(Boolean))].slice(0, limit);
}

function narrativeState(value: unknown): NarrativeState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const state = {
    characters: asString(raw.characters).trim(),
    objects: asString(raw.objects).trim(),
    environment: asString(raw.environment).trim(),
    relationships: asString(raw.relationships).trim(),
    emotion: asString(raw.emotion).trim(),
  };
  return Object.values(state).some(Boolean) ? state : undefined;
}

function clampSilence(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(3, Math.max(0, Math.round(n * 10) / 10)) : fallback;
}

function contextlessMicroDialogue(text: string, storyFunction: string, respondsTo: string): boolean {
  const hanCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const wordCount = (text.match(/[A-Za-z0-9']+/g) || []).length;
  const isVeryShort = hanCount > 0 ? hanCount <= 4 : wordCount > 0 && wordCount <= 3;
  if (!isVeryShort) return false;
  const responseFunction = /^(?:answer|refusal|callback|payoff)$/i.test(storyFunction.trim());
  return !(responseFunction && respondsTo.trim());
}

export function normalizeStoryOutline(raw: any, targetShotCount: number, allowedCharacters: string[] = []): StoryOutline {
  raw = unwrapStoryOutline(raw);
  let nextIndex = 0;
  const sequences: StoryOutlineSequence[] = (Array.isArray(raw?.sequences) ? raw.sequences : [])
    .map((sequence: any, sequenceIndex: number) => {
      const beatMap: StoryOutlineBeat[] = (Array.isArray(sequence?.beatMap) ? sequence.beatMap : [])
        .map((beat: any) => {
          const requiredLine = asString(beat?.requiredLine).replace(/\s+/g, ' ').trim();
          const requestedSpeaker = asString(beat?.requiredSpeaker).trim();
          let requiredSpeaker = allowedCharacters.includes(requestedSpeaker) ? requestedSpeaker : '';
          const requiredDialogueLines = (Array.isArray(beat?.requiredDialogueLines) ? beat.requiredDialogueLines : [])
            .map((line: any) => ({
              character: asString(line?.character || line?.speaker).trim(),
              text: asString(line?.text || line?.exactLine).replace(/\s+/g, ' ').trim(),
            }))
            .filter((line: { character: string; text: string }) => (
              line.text && allowedCharacters.includes(line.character)
            ));
          const requestedPurpose = asString(beat?.dialoguePurpose, 'visual_only').trim();
          const dialogueTurns: StoryOutlineDialogueTurn[] = (Array.isArray(beat?.dialogueTurns) ? beat.dialogueTurns : [])
            .map((turn: any): StoryOutlineDialogueTurn => ({
              speaker: asString(turn?.speaker || turn?.character).trim(),
              function: asString(turn?.function || turn?.storyFunction).trim(),
              contentGoal: asString(turn?.contentGoal || turn?.intent).trim(),
              respondsTo: asString(turn?.respondsTo).trim(),
            }))
            .filter((turn: StoryOutlineDialogueTurn) => allowedCharacters.includes(turn.speaker) && turn.function && turn.contentGoal)
            .slice(0, 4);
          requiredSpeaker = requiredSpeaker
            || requiredDialogueLines[0]?.character
            || dialogueTurns[0]?.speaker
            || '';
          const rawObligation = asString(beat?.dialogueObligation).trim().toLowerCase();
          // A provider occasionally labels the beat `visual` while also
          // returning a complete, valid dialogueTurns contract. Explicit
          // turns contain more information than the coarse flag, so promote
          // the beat to required dialogue instead of failing the whole film.
          const inferredVisual = !requiredLine && !requiredDialogueLines.length && !dialogueTurns.length
            && /(?:visual|纯视觉|无对白)/i.test(rawObligation || requestedPurpose);
          const dialogueObligation: StoryOutlineBeat['dialogueObligation'] = inferredVisual
            ? 'visual'
            : (rawObligation === 'required' || requiredSpeaker || requiredLine ? 'required' : 'optional');
          if (requiredLine && !requiredSpeaker) {
            throw new Error(`镜头 ${nextIndex + 1} 有指定台词但没有有效 requiredSpeaker；临时或未上传角色不得发声`);
          }
          if (dialogueObligation === 'required' && !requiredSpeaker) {
            throw new Error(`镜头 ${nextIndex + 1} 规划了必要对白但没有有效 requiredSpeaker`);
          }
          if (dialogueObligation === 'required' && !requiredLine && requiredDialogueLines.length === 0 && dialogueTurns.length === 0) {
            throw new Error(`镜头 ${nextIndex + 1} 规划了必要对白但没有 dialogueTurns`);
          }
          const dialoguePurpose = dialogueObligation === 'visual' || (dialogueObligation === 'optional' && !requiredSpeaker)
            ? 'visual_only'
            : /(?:visual_only|纯视觉|无对白)/i.test(requestedPurpose)
              ? dialogueTurns.map(turn => turn.function).join('→') || 'story_progression'
              : requestedPurpose;
          return {
            index: ++nextIndex,
            sourceShotRefs: (Array.isArray(beat?.sourceShotRefs) ? beat.sourceShotRefs : [])
              .map(Number).filter((value: number) => Number.isInteger(value) && value > 0),
            actionGoal: asString(beat?.actionGoal, asString(beat?.action)).trim(),
            cause: asString(beat?.cause).trim(),
            consequence: asString(beat?.consequence).trim(),
            emotionalTurn: asString(beat?.emotionalTurn).trim(),
            informationGain: asString(beat?.informationGain).trim(),
            dialoguePurpose,
            dialogueUnitId: asString(beat?.dialogueUnitId).trim(),
            dialogueObligation,
            dialogueContext: asString(beat?.dialogueContext).trim(),
            dialogueTurns: requiredDialogueLines.length
              ? requiredDialogueLines.map((line: { character: string; text: string }, index: number) => ({
                  speaker: line.character,
                  function: index === 0 ? 'user_exact' : 'answer',
                  contentGoal: line.text,
                  respondsTo: index === 0 ? '' : requiredDialogueLines[index - 1].text,
                }))
              : dialogueTurns,
            montageRole: asString(beat?.montageRole, 'development').trim(),
            audienceQuestion: asString(beat?.audienceQuestion).trim(),
            requiredSpeaker,
            requiredLine,
            requiredDialogueLines: requiredDialogueLines.length
              ? requiredDialogueLines
              : (requiredLine && requiredSpeaker ? [{ character: requiredSpeaker, text: requiredLine }] : []),
          };
        });
      return {
        id: asString(sequence?.id, `seq-${sequenceIndex + 1}`),
        locationId: asString(sequence?.locationId, `loc-${sequenceIndex + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
        sceneGoal: asString(sequence?.sceneGoal).trim(),
        dramaticQuestion: asString(sequence?.dramaticQuestion).trim(),
        turningPoint: asString(sequence?.turningPoint).trim(),
        exitHook: asString(sequence?.exitHook).trim(),
        audienceEntry: asString(sequence?.audienceEntry).trim(),
        audienceExit: asString(sequence?.audienceExit).trim(),
        entryState: asString(sequence?.entryState).trim(),
        exitState: asString(sequence?.exitState).trim(),
        shotCount: beatMap.length,
        beatMap,
      };
    })
    .filter((sequence: StoryOutlineSequence) => sequence.beatMap.length > 0);

  if (nextIndex !== targetShotCount) {
    throw new Error(`故事骨架返回了 ${nextIndex} 个镜头地图，但制作规格要求 ${targetShotCount} 个`);
  }
  const requiredSpine = ['centralDramaticQuestion', 'audiencePromise', 'dialogueArc', 'montageStrategy']
    .filter(key => !asString(raw?.[key]).trim());
  if (requiredSpine.length) {
    throw new Error(`故事骨架缺少全片叙事字段：${requiredSpine.join('、')}`);
  }
  if (sequences.some(sequence => !sequence.sceneGoal || !sequence.dramaticQuestion || !sequence.turningPoint
    || !sequence.exitHook || !sequence.audienceEntry || !sequence.audienceExit
    || sequence.beatMap.some(beat => !beat.actionGoal || !beat.cause || !beat.consequence || !beat.informationGain || !beat.audienceQuestion))) {
    throw new Error('故事骨架缺少场次问题/转折/钩子/观众认知，或镜头缺少动作、因果、信息增量与观众问题');
  }
  return { ...raw, sequences } as StoryOutline;
}

export function buildStoryBeatBatches(outline: StoryOutline, maxBatchSize = 6): StoryBeatBatch[] {
  const size = Math.max(1, Math.min(6, Math.floor(maxBatchSize) || 6));
  const maxDialogueTurns = 8;
  const batches: StoryBeatBatch[] = [];
  for (const sequence of outline.sequences) {
    let current: StoryOutlineBeat[] = [];
    let currentTurns = 0;
    const flush = () => {
      if (!current.length) return;
      batches.push({
        sequence,
        beatMap: current,
        batchNumber: batches.length + 1,
      });
      current = [];
      currentTurns = 0;
    };
    for (const beat of sequence.beatMap) {
      const turns = Math.max(beat.dialogueTurns.length, beat.requiredDialogueLines.length);
      const prior = current[current.length - 1];
      const sharedDialogueUnit = Boolean(prior?.dialogueUnitId && prior.dialogueUnitId === beat.dialogueUnitId);
      if (current.length && (current.length >= size
        || (currentTurns + turns > maxDialogueTurns && !sharedDialogueUnit))) flush();
      current.push(beat);
      currentTurns += turns;
    }
    flush();
  }
  return batches;
}

function rawBatchBeats(value: any): any[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.beats) ? value.beats : [];
}

export function structuredRetryCorrection(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  const refused = /(?:unable to assist|can't assist|cannot assist|content safety|rejected by|safety system)/i.test(message);
  if (refused) {
    return `\n\nSAFE-FICTION CORRECTION RETRY: the previous provider response incorrectly refused this non-graphic PG dramatic writing task. Use reaction, blocking, weather, non-graphic peril and aftermath only; do not add blood, wounds, injury detail, suffering close-ups or prohibited content. Preserve all locked facts and exact requiredDialogueLines. Return only complete valid JSON with the exact requested item count.`;
  }
  return `\n\nCORRECTION RETRY: the previous response was invalid (${message}). Return only complete valid JSON and obey the exact requested item count.`;
}

export function filterVisibleStorySpeech(
  value: unknown,
  visibleCharacters: unknown,
  allowedCharacters: string[],
): any[] {
  const visible = Array.isArray(visibleCharacters) ? visibleCharacters.map(String) : [];
  if (!Array.isArray(value)) return [];
  return value.filter((line: any) => {
    const character = asString(line?.character || line?.speaker).trim();
    return Boolean(character && allowedCharacters.includes(character) && visible.includes(character));
  });
}

async function requestStructuredJson<T>(input: {
  prompt: string;
  label: string;
  validate: (raw: any) => T;
  apiKey: string;
  dmxApiKey?: string;
  provider?: ScriptProvider;
  model?: string;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<T> {
  let lastError: unknown;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, Math.min(10_000, attempt === 2 ? 1_500 : attempt * 2_000)));
      }
      const correction = attempt === 1
        ? ''
        : structuredRetryCorrection(lastError);
      const response = await chatOnce(`${input.prompt}${correction}`, {
        apiKey: input.apiKey,
        dmxApiKey: input.dmxApiKey,
        provider: input.provider,
        model: input.model,
        maxOutputTokens: input.maxOutputTokens,
        timeoutMs: input.timeoutMs,
      });
      return input.validate(extractJson(response));
    } catch (error) {
      lastError = error;
      console.warn(`[story-writer] ${input.label} attempt ${attempt}/${maxAttempts} failed:`, error instanceof Error ? error.message : error);
    }
  }
  throw new Error(`${input.label}失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// 清洗/规约 LLM 返回的原始 JSON，保证字段完整、时长合法、名称在允许列表内。
export function sanitizeStoryPlan(
  raw: any,
  allowedCharacters: string[],
  allowedObjects: string[],
  sourceBrief = '',
  targetShotCount?: number,
  voiceIds: Record<string, string | undefined> = {},
  voiceProfiles: Record<string, string | undefined> = {},
  voiceSources: Record<string, 'user' | 'auto' | undefined> = {},
  voiceGenders: Record<string, VoiceGender | undefined> = {},
  voiceAgeGroups: Record<string, VoiceAgeGroup | undefined> = {},
): StoryPlan {
  const characters: PlannedCharacter[] = (Array.isArray(raw?.characters) ? raw.characters : []).map((c: any) => ({
    name: asString(c?.name),
    role: asString(c?.role).trim(),
    gender: voiceGenders[asString(c?.name)] || voiceGender(c?.gender),
    ageGroup: voiceAgeGroups[asString(c?.name)] || voiceAgeGroup(c?.ageGroup),
    want: asString(c?.want),
    obstacle: asString(c?.obstacle),
    arc: asString(c?.arc),
    subtext: asString(c?.subtext),
    voiceId: voiceIds[asString(c?.name)],
    voiceProfile: voiceProfiles[asString(c?.name)] || asString(c?.voiceProfile).trim(),
    voiceSource: voiceSources[asString(c?.name)],
  })).filter((c: PlannedCharacter) => c.name && allowedCharacters.includes(c.name));

  let globalBeatIndex = 0;
  let previousBeatSpeechSignatures = new Set<string>();
  const sequences: StoryPlan['sequences'] = (Array.isArray(raw?.sequences) ? raw.sequences : []).map((seq: any, si: number) => {
    const seqId = asString(seq?.id, `seq-${si + 1}`);
    const locationId = asString(seq?.locationId, `loc-${si + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sceneStyle = asString(seq?.sceneStyle);

    const beats: Beat[] = (Array.isArray(seq?.beats) ? seq.beats : []).map((b: any) => {
      const index = ++globalBeatIndex;
      const rawSpeech = Array.isArray(b?.speech) && b.speech.length
        ? b.speech
        : (Array.isArray(b?.dialogueLines) ? b.dialogueLines : []).map((line: any) => ({
            character: line?.character,
            exactLine: line?.text,
            source: 'story_required',
          }));
      const requiredSpeechCharacters = rawSpeech
        .filter((line: any) => b?.dialogueObligation === 'required' || line?.source === 'user_exact')
        .map((line: any) => asString(line?.character || line?.speaker).trim())
        .filter((name: string) => allowedCharacters.includes(name));
      // A required speaker is necessarily visible for native H3 lip sync. If
      // the model omitted that identity from the coarse cast array, recover it
      // from the authoritative speech contract instead of deleting the line.
      const beatCharacters = [...new Set([
        ...filterNames(b?.characters, allowedCharacters),
        ...requiredSpeechCharacters,
      ])];
      const visibleAction = asString(b?.action);
      const currentBeatSpeechSignatures = new Set<string>();
      const speech: StorySpeechLine[] = rawSpeech.map((line: any): StorySpeechLine | undefined => {
        const character = asString(line?.character || line?.speaker).trim();
        const source = line?.source === 'user_exact' ? 'user_exact' : 'story_required';
        const rawExactLine = asString(line?.exactLine || line?.text).replace(/\s+/g, ' ').trim();
        const exactLine = source === 'user_exact' ? rawExactLine : sanitizeGeneratedSpeechText(rawExactLine);
        if (!character || !exactLine || !allowedCharacters.includes(character) || !beatCharacters.includes(character)) return undefined;
        if (source === 'user_exact' && !sourceBrief.includes(exactLine)) return undefined;
        if (source !== 'user_exact' && isDirectingInstructionDialogue(exactLine)) return undefined;
        if (source !== 'user_exact' && !generatedSpeakerMatchesVisibleAction({
          action: visibleAction,
          characters: beatCharacters,
        } as Storyboard, {
          character,
          source,
        } as StorySpeechLine)) return undefined;
        const signature = `${character}\u0000${exactLine}`;
        if (source !== 'user_exact'
          && (previousBeatSpeechSignatures.has(signature) || currentBeatSpeechSignatures.has(signature))) return undefined;
        currentBeatSpeechSignatures.add(signature);
        return {
          speakerId: `S${allowedCharacters.indexOf(character) + 1}`,
          character,
          voiceId: voiceIds[character],
          exactLine,
          emotion: asString(line?.emotion, 'restrained and scene-appropriate'),
          delivery: asString(line?.delivery, 'natural, concise, no theatrical emphasis'),
          volume: VOLUMES.includes(line?.volume) ? line.volume : 'normal',
          lipSync: line?.lipSync !== false,
          listenerState: asString(line?.listenerState).trim(),
          storyFunction: asString(line?.storyFunction, asString(b?.dialoguePurpose)).trim(),
          respondsTo: asString(line?.respondsTo).trim(),
          source,
        };
      }).filter((line: StorySpeechLine | undefined): line is StorySpeechLine => Boolean(line)).slice(0, 4);
      previousBeatSpeechSignatures = new Set(speech.map(line => `${line.character}\u0000${line.exactLine}`));
      const rawAudio = b?.audioPlan && typeof b.audioPlan === 'object' ? b.audioPlan : {};
      const audioPlan: StoryAudioPlan = {
        backgroundHuman: rawAudio.backgroundHuman === 'indistinct_nonverbal' ? 'indistinct_nonverbal' : 'none',
        environment: stringList(rawAudio.environment),
        foley: stringList(rawAudio.foley),
        music: asString(rawAudio.music, 'none').trim() || 'none',
        silenceBefore: clampSilence(rawAudio.silenceBefore, speech.length ? 0.8 : 0),
        silenceAfter: clampSilence(rawAudio.silenceAfter, speech.length ? 0.8 : 0.4),
      };
      const clipType = CLIP_TYPES.includes(b?.clipType) ? b.clipType : (speech.length ? 'dialogue' : 'action');
      return {
        index,
        sourceShotRefs: (Array.isArray(b?.sourceShotRefs) ? b.sourceShotRefs : [])
          .map(Number).filter((value: number) => Number.isInteger(value) && value > 0),
        sequenceId: asString(b?.sequenceId, seqId),
        locationId: asString(b?.locationId, locationId).replace(/[^a-zA-Z0-9_-]/g, '_'),
        shotSize: asString(b?.shotSize, '中景'),
        cameraMove: asString(b?.cameraMove, '静止'),
        angle: asString(b?.angle, '平视'),
        action: asString(b?.action),
        characters: beatCharacters,
        objects: filterNames(b?.objects, allowedObjects),
        dialogueLines: speech.map(line => ({ character: line.character, text: line.exactLine })),
        speech,
        audioPlan,
        clipType,
        dramaticPurpose: asString(b?.dramaticPurpose, asString(b?.action)),
        cause: asString(b?.cause),
        conflict: asString(b?.conflict),
        choice: asString(b?.choice),
        consequence: asString(b?.consequence),
        characterChange: asString(b?.characterChange),
        nextCause: asString(b?.nextCause),
        informationGain: asString(b?.informationGain),
        dialoguePurpose: asString(b?.dialoguePurpose, speech.length ? 'story_progression' : 'visual_only'),
        dialogueUnitId: asString(b?.dialogueUnitId),
        dialogueObligation: b?.dialogueObligation === 'required' || b?.dialogueObligation === 'optional'
          ? b.dialogueObligation
          : 'visual',
        dialogueContext: asString(b?.dialogueContext),
        montageRole: asString(b?.montageRole, 'development'),
        audienceQuestion: asString(b?.audienceQuestion),
        stateBefore: narrativeState(b?.stateBefore),
        stateAfter: narrativeState(b?.stateAfter),
        durationHint: clampDuration(b?.durationHint),
        transition: validTransition(b?.transition),
        continuityFrom: Number(b?.continuityFrom) || 0,
        sceneStyle: asString(b?.sceneStyle, sceneStyle),
        promptDraft: asString(b?.promptDraft),
      };
    });

    return {
      id: seqId,
      locationId,
      sceneStyle,
      sceneGoal: asString(seq?.sceneGoal),
      dramaticQuestion: asString(seq?.dramaticQuestion),
      turningPoint: asString(seq?.turningPoint),
      exitHook: asString(seq?.exitHook),
      audienceEntry: asString(seq?.audienceEntry),
      audienceExit: asString(seq?.audienceExit),
      beats,
    };
  });

  const validBeatIndexes = new Set(sequences.flatMap(sequence => sequence.beats.map(beat => beat.index)));
  const requirements: StoryRequirement[] = (Array.isArray(raw?.requirements) ? raw.requirements : [])
    .map((requirement: any, index: number) => {
      const category = String(requirement?.category || 'other') as StoryRequirement['category'];
      const priority = requirement?.priority === 'preference' ? 'preference' : 'must';
      const coveredBy = Array.isArray(requirement?.coveredBy)
        ? [...new Set<number>(requirement.coveredBy.map(Number).filter((beatIndex: number) => validBeatIndexes.has(beatIndex)))]
        : [];
      return {
        id: asString(requirement?.id, `req-${index + 1}`),
        text: asString(requirement?.text),
        category: REQUIREMENT_CATEGORIES.includes(category) ? category : 'other',
        priority,
        coveredBy,
      };
    })
    .filter((requirement: StoryRequirement) => requirement.text);

  const normalizedTargetShotCount = normalizeTargetShotCount(targetShotCount);
  const estimatedDurationSeconds = sequences.reduce((total, sequence) => (
    total + sequence.beats.reduce((sequenceTotal, beat) => sequenceTotal + beat.durationHint, 0)
  ), 0);

  return {
    id: asString(raw?.id, `plan-${Date.now()}`),
    targetShotCount: normalizedTargetShotCount,
    targetDurationSeconds: targetDurationSeconds(normalizedTargetShotCount),
    estimatedDurationSeconds,
    sourceBrief,
    intentSummary: asString(raw?.intentSummary),
    requirements,
    title: asString(raw?.title, 'Untitled Story'),
    theme: asString(raw?.theme),
    logline: asString(raw?.logline),
    protagonist: asString(raw?.protagonist, characters[0]?.name || ''),
    externalWant: asString(raw?.externalWant, characters[0]?.want || ''),
    internalNeed: asString(raw?.internalNeed),
    stakes: asString(raw?.stakes),
    obstacle: asString(raw?.obstacle, characters[0]?.obstacle || ''),
    finalChoice: asString(raw?.finalChoice),
    consequence: asString(raw?.consequence),
    change: asString(raw?.change, characters[0]?.arc || ''),
    storyAnchor: asString(raw?.storyAnchor, raw?.visualMotif),
    visualMotif: asString(raw?.visualMotif),
    emotionalArc: asString(raw?.emotionalArc),
    centralDramaticQuestion: asString(raw?.centralDramaticQuestion),
    audiencePromise: asString(raw?.audiencePromise),
    dialogueArc: asString(raw?.dialogueArc),
    montageStrategy: asString(raw?.montageStrategy),
    characters,
    sequences,
  };
}

export async function generateStoryPlan(input: {
  synopsis: string;
  characters: WriterCharacter[];
  objects: WriterObject[];
  apiKey: string;
  language?: 'zh' | 'en';
  scriptProvider?: ScriptProvider;
  scriptModel?: string;
  dmxApiKey?: string;
  targetShotCount?: number;
}): Promise<StoryPlan> {
  const {
    synopsis: sourceSynopsis,
    characters: uploadedCharacters,
    objects,
    apiKey,
    language = 'zh',
    scriptProvider,
    scriptModel = 'gpt-4o',
    dmxApiKey,
  } = input;
  const expanded = expandStoryCharacters(sourceSynopsis, uploadedCharacters, language);
  let characters = expanded.characters;
  const synopsis = expanded.canonicalSynopsis;
  const targetShotCount = normalizeTargetShotCount(input.targetShotCount);
  const isLocalCompanion = process.env.AID_LOCAL_COMPANION === '1';
  const outlinePrompt = buildStoryOutlinePrompt({ synopsis, characters, objects, language, targetShotCount });
  console.log(`[story-writer] generating compact outline for ${targetShotCount} shots`);
  const outline = await requestStructuredJson<StoryOutline>({
    prompt: outlinePrompt,
    label: '故事骨架',
    validate: raw => {
      const normalized = normalizeStoryOutline(raw, targetShotCount, characters.map(character => character.name));
      const authoritative = applySourceDialogueAuthority(normalized, synopsis, characters.map(character => character.name));
      const missingDialogue = missingSourceDialogueLines(authoritative, synopsis, characters.map(character => character.name));
      if (missingDialogue.length) {
        throw new Error(`改编后的 ${targetShotCount} 镜骨架遗漏 ${missingDialogue.length} 条用户逐字台词：${missingDialogue.slice(0, 3).map(line => `${line.character}: “${line.text}”`).join('；')}`);
      }
      return authoritative;
    },
    apiKey,
    dmxApiKey,
    provider: scriptProvider,
    model: scriptModel,
    // The outline now carries four narrative fields per beat plus sequence
    // audience state. The older budget ended around 30k characters for a
    // 27-shot film and providers returned a truncated object; extractJson then
    // found an inner array and validation misleadingly reported zero shots.
    // Even the "compact" outline carries causal state, audience state and a
    // dialogue contract for every shot.  Real 18-shot English projects are
    // already ~10k output tokens; the old 5k + 260/shot budget cut the outer
    // object before its closing brace. extractJson could then recover a valid
    // inner array (usually characters), which misleadingly validated as a
    // zero-shot outline. Give the planner enough room to finish the one
    // authoritative JSON object; detailed screenplay prose is still emitted
    // in the smaller batches below.
    maxOutputTokens: Math.min(24_000, 12_000 + targetShotCount * 450),
    timeoutMs: isLocalCompanion ? 150_000 : 48_000,
  });

  // The outline is the first stage that understands every generated role in
  // story context. Recast automatic voices from its explicit gender/age/role
  // plan before detailed dialogue is written. User-entered Fish ids remain
  // authoritative. Unknown gender stays unbound and is surfaced for review;
  // it is never silently treated as female.
  const plannedByName = new Map<string, any>(
    (Array.isArray((outline as any).characters) ? (outline as any).characters : [])
      .map((character: any) => [asString(character?.name), character] as const),
  );
  characters = castStoryVoices(characters.map(character => {
    const planned = plannedByName.get(character.name);
    if (!planned || character.voiceSource === 'user') return character;
    const role = asString(planned?.role).trim();
    const plannedVoiceProfile = asString(planned?.voiceProfile).trim();
    const storyIdentity = {
      ...character,
      gender: voiceGender(planned?.gender),
      ageGroup: voiceAgeGroup(planned?.ageGroup),
      description: [character.description, role, plannedVoiceProfile].filter(Boolean).join('；'),
      voiceProfile: plannedVoiceProfile || character.voiceProfile,
      voiceId: undefined,
      voiceSource: 'auto' as const,
    };
    return character.description.includes('Text-defined supporting story identity')
      ? resolveGeneratedStoryIdentity(storyIdentity)
      : storyIdentity;
  }), language);

  const batches = buildStoryBeatBatches(outline);
  const detailedBySequence = new Map<string, any[]>();
  const roadmap = outline.sequences.flatMap(sequence => sequence.beatMap);
  let previousBoundary: Record<string, unknown> | undefined;

  for (const batch of batches) {
    const firstIndex = batch.beatMap[0].index;
    const lastIndex = batch.beatMap[batch.beatMap.length - 1].index;
    console.log(`[story-writer] screenplay batch ${batch.batchNumber}/${batches.length}: shots ${firstIndex}-${lastIndex}`);
    const prompt = buildStoryBeatBatchPrompt({
      synopsis,
      outline,
      sequence: batch.sequence,
      beatMap: batch.beatMap,
      previousBoundary,
      continuesSequence: previousBoundary?.sequenceId === batch.sequence.id,
      nextRoadmap: roadmap.filter(beat => beat.index > lastIndex).slice(0, 2),
      characters,
      objects,
      language,
    });
    const beats = await requestStructuredJson<any[]>({
      prompt,
      label: `详细剧本 ${firstIndex}–${lastIndex}`,
      validate: raw => {
        const batchBeats = rawBatchBeats(raw);
        if (batchBeats.length !== batch.beatMap.length) {
          throw new Error(`返回 ${batchBeats.length} 镜，要求 ${batch.beatMap.length} 镜`);
        }
        batchBeats.forEach((beat, index) => {
          const authority = batch.beatMap[index];
          const required = {
            action: asString(beat?.action, authority.actionGoal),
            cause: asString(beat?.cause, authority.cause),
            conflict: normalizedBeatConflict(beat?.conflict, authority, targetShotCount, language),
            consequence: asString(beat?.consequence, authority.consequence),
            nextCause: normalizedBeatNextCause(beat?.nextCause, authority, targetShotCount, language),
            informationGain: asString(beat?.informationGain, authority.informationGain),
            dialoguePurpose: asString(beat?.dialoguePurpose, authority.dialoguePurpose),
            montageRole: asString(beat?.montageRole, authority.montageRole),
            audienceQuestion: asString(beat?.audienceQuestion, authority.audienceQuestion),
          };
          const missing = Object.entries(required).filter(([, value]) => !value.trim()).map(([key]) => key);
          if (missing.length) throw new Error(`镜头 ${authority.index} 缺少叙事字段：${missing.join('、')}`);
          // Persist the resolution fallback into the final Beat rather than
          // merely using it to pass validation.
          beat.conflict = required.conflict;
          beat.nextCause = required.nextCause;
          let purpose = required.dialoguePurpose.toLowerCase();
          const authoritativeDialogue = authority.requiredDialogueLines || [];
          const plannedTurns = authority.dialogueTurns || [];
          if (authoritativeDialogue.length || plannedTurns.length) {
            const submittedCharacters = Array.isArray(beat?.characters) ? beat.characters.map(String) : [];
            beat.characters = [...new Set([
              ...submittedCharacters,
              ...authoritativeDialogue.map(line => line.character),
              ...plannedTurns.map(turn => turn.speaker),
            ])];
          }
          let submittedSpeech = authoritativeDialogue.length
            ? authoritativeDialogue.map(line => {
                const generated = (Array.isArray(beat?.speech) ? beat.speech : []).find((candidate: any) => (
                  asString(candidate?.character || candidate?.speaker).trim() === line.character
                    && asString(candidate?.exactLine || candidate?.text).replace(/\s+/g, ' ').trim() === line.text
                ));
                return {
                  ...generated,
                  character: line.character,
                  exactLine: line.text,
                  source: 'user_exact',
                  storyFunction: asString(generated?.storyFunction, required.dialoguePurpose).trim() || 'story_progression',
                };
              })
            : (Array.isArray(beat?.speech) ? beat.speech : []);
          if (!authoritativeDialogue.length && plannedTurns.length) {
            if (submittedSpeech.length !== plannedTurns.length) {
              throw new Error(`镜头 ${authority.index} 的对白单元 ${authority.dialogueUnitId || ''} 返回 ${submittedSpeech.length} 轮，规划要求 ${plannedTurns.length} 轮`);
            }
            submittedSpeech = submittedSpeech.map((line: any, lineIndex: number) => {
              const turn = plannedTurns[lineIndex];
              const submittedSpeaker = asString(line?.character || line?.speaker).trim();
              if (submittedSpeaker !== turn.speaker) {
                throw new Error(`镜头 ${authority.index} 第 ${lineIndex + 1} 轮说话者应为 ${turn.speaker}，实际为 ${submittedSpeaker || '空'}`);
              }
              const submittedFunction = asString(line?.storyFunction).trim();
              if (submittedFunction && submittedFunction !== turn.function) {
                throw new Error(`镜头 ${authority.index} 第 ${lineIndex + 1} 轮功能应为 ${turn.function}，实际为 ${submittedFunction}`);
              }
              return {
                ...line,
                character: turn.speaker,
                storyFunction: turn.function,
                respondsTo: asString(line?.respondsTo, turn.respondsTo).trim() || turn.respondsTo,
              };
            });
          }
          const rawSpeech = filterVisibleStorySpeech(
            submittedSpeech,
            beat?.characters,
            characters.map(character => character.name),
          );
          beat.speech = rawSpeech;
          if (!/(?:visual_only|纯视觉|无对白)/.test(purpose) && rawSpeech.length === 0) {
            if (authority.requiredDialogueLines.length || authority.requiredLine) {
              throw new Error(`镜头 ${authority.index} 规划了 ${required.dialoguePurpose} 台词功能，但没有生成 speech`);
            }
            if (authority.dialogueObligation === 'required') {
              throw new Error(`镜头 ${authority.index} 的必要对白单元 ${authority.dialogueUnitId || ''} 没有生成 speech`);
            }
            beat.dialoguePurpose = 'visual_only';
            required.dialoguePurpose = 'visual_only';
            purpose = 'visual_only';
          }
          if (rawSpeech.length > 4) throw new Error(`镜头 ${authority.index} 返回超过 4 条台词`);
          rawSpeech.forEach((line: any, lineIndex: number) => {
            const exactLine = sanitizeGeneratedSpeechText(line?.exactLine || line?.text);
            const storyFunction = asString(line?.storyFunction).trim();
            const respondsTo = asString(line?.respondsTo).trim();
            if (!exactLine || !storyFunction) {
              throw new Error(`镜头 ${authority.index} 第 ${lineIndex + 1} 条台词缺少可朗读原文或 storyFunction`);
            }
            if (line?.source !== 'user_exact' && contextlessMicroDialogue(exactLine, storyFunction, respondsTo)) {
              throw new Error(`镜头 ${authority.index} 第 ${lineIndex + 1} 条台词“${exactLine}”过短且没有明确承接关系，无法独立传递剧情`);
            }
            // `characters` is the authoritative visible-cast list. Do not
            // require the prose action to repeat a non-Latin uploaded name:
            // English models commonly write "the mermaid princess" while the
            // exact library identity remains 人鱼公主. The exact speech binding
            // above is sufficient and avoids rejecting a semantically valid
            // scene merely because its prose uses a natural-language alias.
          });
          if (rawSpeech.length) {
            const speechDuration = rawSpeech.reduce((total: number, line: any) => (
              total + speechSeconds(sanitizeGeneratedSpeechText(line?.exactLine || line?.text))
            ), 0);
            const requiredDuration = speechDuration
              + Math.max(0, rawSpeech.length - 1) * 0.35
              + Math.max(0.45, Number(beat?.audioPlan?.silenceBefore) || 0)
              + Math.max(0.55, Number(beat?.audioPlan?.silenceAfter) || 0);
            if (requiredDuration > 15) {
              throw new Error(`镜头 ${authority.index} 的多轮台词至少需要 ${requiredDuration.toFixed(1)} 秒，超过 H3 15 秒；请缩短自行创作台词，用户原台词则必须在故事骨架阶段拆到相邻镜头`);
            }
          }
        });
        return batchBeats.map((beat, index) => {
          const authority = batch.beatMap[index];
          return {
            ...beat,
            index: authority.index,
            sourceShotRefs: authority.sourceShotRefs,
            sequenceId: batch.sequence.id,
            locationId: batch.sequence.locationId,
            action: asString(beat?.action, authority.actionGoal),
            dramaticPurpose: asString(beat?.dramaticPurpose, authority.actionGoal),
            cause: asString(beat?.cause, authority.cause),
            consequence: asString(beat?.consequence, authority.consequence),
            characterChange: asString(beat?.characterChange, authority.emotionalTurn),
            informationGain: asString(beat?.informationGain, authority.informationGain),
            dialoguePurpose: asString(beat?.dialoguePurpose, authority.dialoguePurpose),
            dialogueUnitId: authority.dialogueUnitId,
            dialogueObligation: authority.dialogueObligation,
            dialogueContext: authority.dialogueContext,
            montageRole: asString(beat?.montageRole, authority.montageRole),
            audienceQuestion: asString(beat?.audienceQuestion, authority.audienceQuestion),
            speech: authority.requiredDialogueLines.length
              ? authority.requiredDialogueLines.map(line => {
                  const generated = (Array.isArray(beat?.speech) ? beat.speech : []).find((candidate: any) => (
                    asString(candidate?.character || candidate?.speaker).trim() === line.character
                      && asString(candidate?.exactLine || candidate?.text).replace(/\s+/g, ' ').trim() === line.text
                  ));
                  return {
                    ...generated,
                    character: line.character,
                    exactLine: line.text,
                    source: 'user_exact',
                    storyFunction: asString(generated?.storyFunction, authority.dialoguePurpose).trim() || 'story_progression',
                  };
                })
              : (authority.requiredLine && authority.requiredSpeaker
                ? [{
                    ...(Array.isArray(beat?.speech)
                      ? beat.speech.find((line: any) => asString(line?.character || line?.speaker).trim() === authority.requiredSpeaker)
                      : undefined),
                    character: authority.requiredSpeaker,
                    exactLine: authority.requiredLine,
                    source: synopsis.includes(authority.requiredLine) ? 'user_exact' : 'story_required',
                  }]
                : beat?.speech),
            promptDraft: '',
            sceneStyle: '',
          };
        });
      },
      apiKey,
      dmxApiKey,
      provider: scriptProvider,
      model: scriptModel,
      maxOutputTokens: 9_000,
      timeoutMs: isLocalCompanion ? 120_000 : 48_000,
    });

    // Within one continuous sequence the prior physical state is authoritative.
    // A new sequence may change location/time, so it receives the boundary as
    // context but keeps its own explicit entry state.
    const existing = detailedBySequence.get(batch.sequence.id) || [];
    beats.forEach((beat, index) => {
      const prior = index > 0 ? beats[index - 1] : existing[existing.length - 1];
      if (prior?.stateAfter) beat.stateBefore = prior.stateAfter;
    });
    detailedBySequence.set(batch.sequence.id, [...existing, ...beats]);
    const lastBeat = beats[beats.length - 1];
    previousBoundary = {
      sequenceId: batch.sequence.id,
      index: lastBeat.index,
      action: lastBeat.action,
      consequence: lastBeat.consequence,
      nextCause: lastBeat.nextCause,
      stateAfter: lastBeat.stateAfter,
      speech: lastBeat.speech,
    };
  }

  const raw = {
    ...outline,
    sequences: outline.sequences.map(sequence => ({
      id: sequence.id,
      locationId: sequence.locationId,
      sceneGoal: sequence.sceneGoal,
      dramaticQuestion: sequence.dramaticQuestion,
      turningPoint: sequence.turningPoint,
      exitHook: sequence.exitHook,
      audienceEntry: sequence.audienceEntry,
      audienceExit: sequence.audienceExit,
      sceneStyle: '',
      beats: detailedBySequence.get(sequence.id) || [],
    })),
  };

  const plan = sanitizeStoryPlan(
    raw,
    characters.map(c => c.name),
    objects.map(o => o.name),
    sourceSynopsis,
    targetShotCount,
    Object.fromEntries(characters.map(character => [character.name, character.voiceId])),
    Object.fromEntries(characters.map(character => [character.name, character.voiceProfile])),
    Object.fromEntries(characters.map(character => [character.name, character.voiceSource])),
    Object.fromEntries(characters.map(character => [character.name, character.gender])),
    Object.fromEntries(characters.map(character => [character.name, character.ageGroup])),
  );
  const actualShotCount = storyPlanBeatCount(plan);
  if (actualShotCount !== targetShotCount) {
    throw new Error(`剧本模型返回了 ${actualShotCount} 个镜头，但制作规格要求 ${targetShotCount} 个；请重试生成`);
  }
  const missingRequiredDialogue = plan.sequences
    .flatMap(sequence => sequence.beats)
    .filter(beat => beat.dialogueObligation === 'required' && (!beat.speech || beat.speech.length === 0));
  if (missingRequiredDialogue.length) {
    throw new Error(`必要对白在结构化校验后丢失：镜头 ${missingRequiredDialogue.map(beat => beat.index).join('、')}；请重试生成`);
  }
  return plan;
}
