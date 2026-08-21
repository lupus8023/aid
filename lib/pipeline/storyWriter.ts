import type { StoryPlan, Beat, PlannedCharacter, StoryRequirement, WriterCharacter, WriterObject } from './types';
import { buildStoryBeatBatchPrompt, buildStoryOutlinePrompt } from './storyWriterPrompt';
import { chatOnce, type ScriptProvider } from './llm';
import { extractJson } from './json';
import { normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from './shotCount';
import type { NarrativeState, StoryAudioPlan, StoryClipType, StorySpeechLine } from '@/types';
import { isDirectingInstructionDialogue, sanitizeGeneratedSpeechText } from '@/lib/speechAudioContract';

const TRANSITIONS: Beat['transition'][] = ['cut', 'dissolve', 'fade', 'wipe'];
const REQUIREMENT_CATEGORIES: StoryRequirement['category'][] = ['plot', 'character', 'setting', 'tone', 'format', 'pacing', 'dialogue', 'visual', 'avoid', 'other'];
const CLIP_TYPES: StoryClipType[] = ['insert', 'reaction', 'establishing', 'action', 'dialogue', 'performance', 'montage', 'long_take'];
const VOLUMES: StorySpeechLine['volume'][] = ['whisper', 'soft', 'normal', 'raised'];

export interface StoryOutlineBeat {
  index: number;
  actionGoal: string;
  cause: string;
  consequence: string;
  emotionalTurn: string;
  requiredLine: string;
}

export interface StoryOutlineSequence {
  id: string;
  locationId: string;
  sceneGoal: string;
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

export function normalizeStoryOutline(raw: any, targetShotCount: number): StoryOutline {
  let nextIndex = 0;
  const sequences: StoryOutlineSequence[] = (Array.isArray(raw?.sequences) ? raw.sequences : [])
    .map((sequence: any, sequenceIndex: number) => {
      const beatMap: StoryOutlineBeat[] = (Array.isArray(sequence?.beatMap) ? sequence.beatMap : [])
        .map((beat: any) => ({
          index: ++nextIndex,
          actionGoal: asString(beat?.actionGoal, asString(beat?.action)).trim(),
          cause: asString(beat?.cause).trim(),
          consequence: asString(beat?.consequence).trim(),
          emotionalTurn: asString(beat?.emotionalTurn).trim(),
          requiredLine: asString(beat?.requiredLine).replace(/\s+/g, ' ').trim(),
        }));
      return {
        id: asString(sequence?.id, `seq-${sequenceIndex + 1}`),
        locationId: asString(sequence?.locationId, `loc-${sequenceIndex + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
        sceneGoal: asString(sequence?.sceneGoal).trim(),
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
  if (sequences.some(sequence => !sequence.sceneGoal || sequence.beatMap.some(beat => !beat.actionGoal))) {
    throw new Error('故事骨架缺少场次目标或镜头动作目标');
  }
  return { ...raw, sequences } as StoryOutline;
}

export function buildStoryBeatBatches(outline: StoryOutline, maxBatchSize = 9): StoryBeatBatch[] {
  const size = Math.max(1, Math.min(9, Math.floor(maxBatchSize) || 9));
  const batches: StoryBeatBatch[] = [];
  for (const sequence of outline.sequences) {
    for (let index = 0; index < sequence.beatMap.length; index += size) {
      batches.push({
        sequence,
        beatMap: sequence.beatMap.slice(index, index + size),
        batchNumber: batches.length + 1,
      });
    }
  }
  return batches;
}

function rawBatchBeats(value: any): any[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.beats) ? value.beats : [];
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
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const correction = attempt === 1
        ? ''
        : `\n\nCORRECTION RETRY: the previous response was invalid (${lastError instanceof Error ? lastError.message : 'unknown error'}). Return only complete valid JSON and obey the exact requested item count.`;
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
      console.warn(`[story-writer] ${input.label} attempt ${attempt}/2 failed:`, error instanceof Error ? error.message : error);
      if (/timeout|timed out|ECONNABORTED/i.test(error instanceof Error ? error.message : String(error))) break;
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
): StoryPlan {
  const characters: PlannedCharacter[] = (Array.isArray(raw?.characters) ? raw.characters : []).map((c: any) => ({
    name: asString(c?.name),
    want: asString(c?.want),
    obstacle: asString(c?.obstacle),
    arc: asString(c?.arc),
    subtext: asString(c?.subtext),
  })).filter((c: PlannedCharacter) => c.name && allowedCharacters.includes(c.name));

  let globalBeatIndex = 0;
  let previousBeatSpeechSignature = '';
  const sequences: StoryPlan['sequences'] = (Array.isArray(raw?.sequences) ? raw.sequences : []).map((seq: any, si: number) => {
    const seqId = asString(seq?.id, `seq-${si + 1}`);
    const locationId = asString(seq?.locationId, `loc-${si + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sceneStyle = asString(seq?.sceneStyle);

    const beats: Beat[] = (Array.isArray(seq?.beats) ? seq.beats : []).map((b: any) => {
      const index = ++globalBeatIndex;
      const beatCharacters = filterNames(b?.characters, allowedCharacters);
      const rawSpeech = Array.isArray(b?.speech) && b.speech.length
        ? b.speech
        : (Array.isArray(b?.dialogueLines) ? b.dialogueLines : []).map((line: any) => ({
            character: line?.character,
            exactLine: line?.text,
            source: 'story_required',
          }));
      const speech: StorySpeechLine[] = rawSpeech.map((line: any): StorySpeechLine | undefined => {
        const character = asString(line?.character || line?.speaker).trim();
        const source = line?.source === 'user_exact' ? 'user_exact' : 'story_required';
        const rawExactLine = asString(line?.exactLine || line?.text).replace(/\s+/g, ' ').trim();
        const exactLine = source === 'user_exact' ? rawExactLine : sanitizeGeneratedSpeechText(rawExactLine);
        if (!character || !exactLine || !allowedCharacters.includes(character) || !beatCharacters.includes(character)) return undefined;
        if (source === 'user_exact' && !sourceBrief.includes(exactLine)) return undefined;
        if (source !== 'user_exact' && isDirectingInstructionDialogue(exactLine)) return undefined;
        const signature = `${character}\u0000${exactLine}`;
        if (signature === previousBeatSpeechSignature) return undefined;
        return {
          speakerId: `S${String(allowedCharacters.indexOf(character) + 1).padStart(2, '0')}`,
          character,
          voiceId: voiceIds[character],
          exactLine,
          emotion: asString(line?.emotion, 'restrained and scene-appropriate'),
          delivery: asString(line?.delivery, 'natural, concise, no theatrical emphasis'),
          volume: VOLUMES.includes(line?.volume) ? line.volume : 'normal',
          lipSync: line?.lipSync !== false,
          source,
        };
      }).filter((line: StorySpeechLine | undefined): line is StorySpeechLine => Boolean(line)).slice(0, 1);
      previousBeatSpeechSignature = speech.length ? `${speech[0].character}\u0000${speech[0].exactLine}` : '';
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
        stateBefore: narrativeState(b?.stateBefore),
        stateAfter: narrativeState(b?.stateAfter),
        durationHint: clampDuration(b?.durationHint),
        transition: validTransition(b?.transition),
        continuityFrom: Number(b?.continuityFrom) || 0,
        sceneStyle: asString(b?.sceneStyle, sceneStyle),
        promptDraft: asString(b?.promptDraft),
      };
    });

    return { id: seqId, locationId, sceneStyle, beats };
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
  const { synopsis, characters, objects, apiKey, language = 'zh', scriptProvider, scriptModel = 'gpt-4o', dmxApiKey } = input;
  const targetShotCount = normalizeTargetShotCount(input.targetShotCount);
  const isLocalCompanion = process.env.AID_LOCAL_COMPANION === '1';
  const outlinePrompt = buildStoryOutlinePrompt({ synopsis, characters, objects, language, targetShotCount });
  console.log(`[story-writer] generating compact outline for ${targetShotCount} shots`);
  const outline = await requestStructuredJson<StoryOutline>({
    prompt: outlinePrompt,
    label: '故事骨架',
    validate: raw => normalizeStoryOutline(raw, targetShotCount),
    apiKey,
    dmxApiKey,
    provider: scriptProvider,
    model: scriptModel,
    maxOutputTokens: Math.min(14_000, 4_000 + targetShotCount * 120),
    timeoutMs: isLocalCompanion ? 150_000 : 48_000,
  });

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
        return batchBeats.map((beat, index) => {
          const authority = batch.beatMap[index];
          return {
            ...beat,
            index: authority.index,
            sequenceId: batch.sequence.id,
            locationId: batch.sequence.locationId,
            action: asString(beat?.action, authority.actionGoal),
            dramaticPurpose: asString(beat?.dramaticPurpose, authority.actionGoal),
            cause: asString(beat?.cause, authority.cause),
            consequence: asString(beat?.consequence, authority.consequence),
            characterChange: asString(beat?.characterChange, authority.emotionalTurn),
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
      sceneStyle: '',
      beats: detailedBySequence.get(sequence.id) || [],
    })),
  };

  const plan = sanitizeStoryPlan(
    raw,
    characters.map(c => c.name),
    objects.map(o => o.name),
    synopsis,
    targetShotCount,
    Object.fromEntries(characters.map(character => [character.name, character.voiceId])),
  );
  const actualShotCount = storyPlanBeatCount(plan);
  if (actualShotCount !== targetShotCount) {
    throw new Error(`剧本模型返回了 ${actualShotCount} 个镜头，但制作规格要求 ${targetShotCount} 个；请重试生成`);
  }
  return plan;
}
