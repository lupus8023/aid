import { StoryPlan, Beat, PlannedCharacter, StoryRequirement, WriterCharacter, WriterObject } from './types';
import { buildStoryPlanPrompt } from './storyWriterPrompt';
import { chatOnce } from './llm';
import { extractJson } from './json';
import { normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from './shotCount';

const TRANSITIONS: Beat['transition'][] = ['cut', 'dissolve', 'fade', 'wipe'];
const REQUIREMENT_CATEGORIES: StoryRequirement['category'][] = ['plot', 'character', 'setting', 'tone', 'format', 'pacing', 'dialogue', 'visual', 'avoid', 'other'];

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

// 清洗/规约 LLM 返回的原始 JSON，保证字段完整、时长合法、名称在允许列表内。
export function sanitizeStoryPlan(raw: any, allowedCharacters: string[], allowedObjects: string[], sourceBrief = '', targetShotCount?: number): StoryPlan {
  const characters: PlannedCharacter[] = (Array.isArray(raw?.characters) ? raw.characters : []).map((c: any) => ({
    name: asString(c?.name),
    want: asString(c?.want),
    obstacle: asString(c?.obstacle),
    arc: asString(c?.arc),
    subtext: asString(c?.subtext),
  })).filter((c: PlannedCharacter) => c.name && allowedCharacters.includes(c.name));

  let globalBeatIndex = 0;
  const sequences: StoryPlan['sequences'] = (Array.isArray(raw?.sequences) ? raw.sequences : []).map((seq: any, si: number) => {
    const seqId = asString(seq?.id, `seq-${si + 1}`);
    const locationId = asString(seq?.locationId, `loc-${si + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sceneStyle = asString(seq?.sceneStyle);

    const beats: Beat[] = (Array.isArray(seq?.beats) ? seq.beats : []).map((b: any) => ({
      index: ++globalBeatIndex,
      sequenceId: asString(b?.sequenceId, seqId),
      locationId: asString(b?.locationId, locationId).replace(/[^a-zA-Z0-9_-]/g, '_'),
      shotSize: asString(b?.shotSize, '中景'),
      cameraMove: asString(b?.cameraMove, '静止'),
      angle: asString(b?.angle, '平视'),
      action: asString(b?.action),
      characters: filterNames(b?.characters, allowedCharacters),
      objects: filterNames(b?.objects, allowedObjects),
      dialogueLines: (Array.isArray(b?.dialogueLines) ? b.dialogueLines : []).map((d: any) => ({
        character: asString(d?.character),
        text: asString(d?.text),
      })).filter((d: { character: string; text: string }) => d.character && d.text),
      durationHint: clampDuration(b?.durationHint),
      transition: validTransition(b?.transition),
      continuityFrom: Number(b?.continuityFrom) || 0,
      sceneStyle: asString(b?.sceneStyle, sceneStyle),
      promptDraft: asString(b?.promptDraft),
    }));

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
    theme: asString(raw?.theme),
    logline: asString(raw?.logline),
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
  scriptModel?: string;
  dmxApiKey?: string;
  targetShotCount?: number;
}): Promise<StoryPlan> {
  const { synopsis, characters, objects, apiKey, language = 'zh', scriptModel = 'gpt-4o', dmxApiKey } = input;
  const targetShotCount = normalizeTargetShotCount(input.targetShotCount);
  const prompt = buildStoryPlanPrompt({ synopsis, characters, objects, language, targetShotCount });

  const response = await chatOnce(prompt, { apiKey, dmxApiKey, model: scriptModel });

  const raw = extractJson(response);

  const plan = sanitizeStoryPlan(
    raw,
    characters.map(c => c.name),
    objects.map(o => o.name),
    synopsis,
    targetShotCount,
  );
  const actualShotCount = storyPlanBeatCount(plan);
  if (actualShotCount !== targetShotCount) {
    throw new Error(`剧本模型返回了 ${actualShotCount} 个镜头，但制作规格要求 ${targetShotCount} 个；请重试生成`);
  }
  return plan;
}
