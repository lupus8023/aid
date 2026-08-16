import { StoryPlan, Beat, PlannedCharacter, WriterCharacter, WriterObject } from './types';
import { buildStoryPlanPrompt } from './storyWriterPrompt';
import { chatOnce } from './llm';

const TRANSITIONS: Beat['transition'][] = ['cut', 'dissolve', 'fade', 'wipe'];

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
export function sanitizeStoryPlan(raw: any, allowedCharacters: string[], allowedObjects: string[]): StoryPlan {
  const characters: PlannedCharacter[] = (Array.isArray(raw?.characters) ? raw.characters : []).map((c: any) => ({
    name: asString(c?.name),
    want: asString(c?.want),
    obstacle: asString(c?.obstacle),
    arc: asString(c?.arc),
    subtext: asString(c?.subtext),
  })).filter((c: PlannedCharacter) => c.name && allowedCharacters.includes(c.name));

  const sequences = (Array.isArray(raw?.sequences) ? raw.sequences : []).map((seq: any, si: number) => {
    const seqId = asString(seq?.id, `seq-${si + 1}`);
    const locationId = asString(seq?.locationId, `loc-${si + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sceneStyle = asString(seq?.sceneStyle);

    const beats: Beat[] = (Array.isArray(seq?.beats) ? seq.beats : []).map((b: any, bi: number) => ({
      index: Number(b?.index) || bi + 1,
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

  return {
    id: asString(raw?.id, `plan-${Date.now()}`),
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
}): Promise<StoryPlan> {
  const { synopsis, characters, objects, apiKey, language = 'zh', scriptModel = 'gpt-4o', dmxApiKey } = input;
  const prompt = buildStoryPlanPrompt({ synopsis, characters, objects, language });

  const response = await chatOnce(prompt, { apiKey, dmxApiKey, model: scriptModel });

  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Failed to parse story plan JSON from AI response');
  }
  const raw = JSON.parse(response.slice(start, end + 1));

  return sanitizeStoryPlan(
    raw,
    characters.map(c => c.name),
    objects.map(o => o.name),
  );
}
