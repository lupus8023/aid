import type { StoryPlan, Beat, PlannedCharacter, StoryRequirement, WriterCharacter, WriterObject } from './types';
import { buildStoryPlanPrompt } from './storyWriterPrompt';
import { chatOnce, type ScriptProvider } from './llm';
import { extractJson } from './json';
import { normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from './shotCount';
import type { NarrativeState, StoryAudioPlan, StoryClipType, StorySpeechLine } from '@/types';

const TRANSITIONS: Beat['transition'][] = ['cut', 'dissolve', 'fade', 'wipe'];
const REQUIREMENT_CATEGORIES: StoryRequirement['category'][] = ['plot', 'character', 'setting', 'tone', 'format', 'pacing', 'dialogue', 'visual', 'avoid', 'other'];
const CLIP_TYPES: StoryClipType[] = ['insert', 'reaction', 'establishing', 'action', 'dialogue', 'performance', 'montage', 'long_take'];
const VOLUMES: StorySpeechLine['volume'][] = ['whisper', 'soft', 'normal', 'raised'];

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
        const exactLine = asString(line?.exactLine || line?.text).replace(/\s+/g, ' ').trim();
        const source = line?.source === 'user_exact' ? 'user_exact' : 'story_required';
        if (!character || !exactLine || !allowedCharacters.includes(character) || !beatCharacters.includes(character)) return undefined;
        if (source === 'user_exact' && !sourceBrief.includes(exactLine)) return undefined;
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
          listenerState: asString(line?.listenerState, 'Other visible characters listen silently with closed mouths.'),
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
  const prompt = buildStoryPlanPrompt({ synopsis, characters, objects, language, targetShotCount });

  const response = await chatOnce(prompt, { apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel });

  const raw = extractJson(response);

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
