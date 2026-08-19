import type { StoryAudioPlan, Storyboard, StorySpeechLine } from '@/types';

export interface TimedSpeechLine extends StorySpeechLine {
  storyboardIndex: number;
  sceneNumber: number;
  start: number;
  end: number;
}

const DEFAULT_AUDIO: StoryAudioPlan = {
  backgroundHuman: 'none',
  environment: [],
  foley: [],
  music: 'none',
  silenceBefore: 0.8,
  silenceAfter: 0.8,
};

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableSpeakerId(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) % 97;
  return `S${String(hash + 1).padStart(2, '0')}`;
}

export function speechSeconds(text: string): number {
  const value = clean(text);
  const han = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9']+/g) || []).length;
  const punctuation = (value.match(/[，。！？,.!?;；:：]/g) || []).length;
  return Math.max(0.8, han / 4.2 + words / 2.4 + punctuation * 0.08);
}

export function storyboardSpeech(storyboard: Storyboard): StorySpeechLine[] {
  const visible = new Set(storyboard.characters || []);
  const source = storyboard.speech?.length
    ? storyboard.speech
    : (storyboard.dialogueLines?.length
        ? storyboard.dialogueLines
        : Object.entries(storyboard.dialogue || {}).map(([character, text]) => ({ character, text })))
      .map((line: any) => ({
        speakerId: stableSpeakerId(clean(line.character)),
        character: clean(line.character),
        exactLine: clean(line.text),
        emotion: 'restrained and scene-appropriate',
        delivery: 'natural, concise, no theatrical emphasis',
        volume: 'normal' as const,
        lipSync: true,
        listenerState: 'Other visible characters listen silently with closed mouths.',
        source: 'story_required' as const,
      }));

  return source
    .map(line => ({
      ...line,
      speakerId: clean(line.speakerId) || stableSpeakerId(clean(line.character)),
      character: clean(line.character),
      exactLine: clean(line.exactLine),
      emotion: clean(line.emotion) || 'restrained and scene-appropriate',
      delivery: clean(line.delivery) || 'natural, concise, no theatrical emphasis',
      volume: line.volume || 'normal',
      lipSync: line.lipSync !== false,
      listenerState: clean(line.listenerState) || 'Other visible characters listen silently with closed mouths.',
      source: line.source === 'user_exact' ? 'user_exact' as const : 'story_required' as const,
    }))
    .filter(line => line.character && line.exactLine && visible.has(line.character))
    .slice(0, 1);
}

export function storyboardAudioPlan(storyboard: Storyboard): StoryAudioPlan {
  const plan = storyboard.audioPlan;
  if (!plan) return DEFAULT_AUDIO;
  return {
    backgroundHuman: plan.backgroundHuman === 'indistinct_nonverbal' ? 'indistinct_nonverbal' : 'none',
    environment: [...new Set((plan.environment || []).map(clean).filter(Boolean))].slice(0, 4),
    foley: [...new Set((plan.foley || []).map(clean).filter(Boolean))].slice(0, 4),
    music: clean(plan.music) || 'none',
    silenceBefore: Math.min(3, Math.max(0, Number(plan.silenceBefore) || 0)),
    silenceAfter: Math.min(3, Math.max(0, Number(plan.silenceAfter) || 0)),
  };
}

export function validateSpeechContract(storyboards: Storyboard[]): string | undefined {
  const lines = storyboards.flatMap(storyboardSpeech);
  const rawCount = storyboards.reduce((total, storyboard) => total + (
    storyboard.speech?.length || storyboard.dialogueLines?.length || Object.keys(storyboard.dialogue || {}).length
  ), 0);
  if (rawCount > lines.length) return '台词中存在未出场角色、空台词或同一镜头多人说话，请先修正剧本';
  if (lines.length > 3) return '一个 H3 片段最多安排 3 条顺序台词，请拆成独立片段';
  if (new Set(lines.map(line => line.character)).size > 3) return '一个 H3 片段最多绑定 3 个说话角色，请拆成独立片段';
  const overlong = lines.find(line => speechSeconds(line.exactLine) > 11.5);
  if (overlong) return `台词过长，无法在 15 秒内保留开场留白和说后反应：${overlong.character}`;
  return undefined;
}

export function compileTimedSpeech(
  storyboards: Storyboard[],
  timeline: Array<{ start: number; end: number }>,
): TimedSpeechLine[] {
  const error = validateSpeechContract(storyboards);
  if (error) throw new Error(error);
  const timed: TimedSpeechLine[] = [];
  storyboards.forEach((storyboard, index) => {
    const line = storyboardSpeech(storyboard)[0];
    if (!line) return;
    const range = timeline[index];
    const plan = storyboardAudioPlan(storyboard);
    const available = Math.max(0.8, range.end - range.start);
    const lead = Math.min(Math.max(0.6, plan.silenceBefore), available * 0.25);
    const tail = Math.min(Math.max(0.7, plan.silenceAfter), available * 0.25);
    const start = range.start + lead;
    const end = Math.min(range.end - tail, start + speechSeconds(line.exactLine));
    if (end - start < Math.min(0.8, speechSeconds(line.exactLine) * 0.75)) {
      throw new Error(`镜头 ${storyboard.sceneNumber} 的台词时长不足，请拆分台词或延长该片段`);
    }
    timed.push({ ...line, storyboardIndex: index, sceneNumber: storyboard.sceneNumber, start, end });
  });
  return timed;
}

export function buildAudioManifest(storyboards: Storyboard[], timedSpeech: TimedSpeechLine[]): string {
  const plans = storyboards.map(storyboardAudioPlan);
  const environment = [...new Set(plans.flatMap(plan => plan.environment))];
  const foley = [...new Set(plans.flatMap(plan => plan.foley))];
  const allowBackgroundPresence = plans.some(plan => plan.backgroundHuman === 'indistinct_nonverbal');
  return [
    environment.length
      ? `The location ambience consists only of ${environment.join('; ')}.`
      : 'A quiet, perspective-correct location room tone continues underneath the visible action.',
    foley.length
      ? `Physical action sounds are limited to ${foley.join('; ')}, synchronized to their visible causes.`
      : 'Only contacts visibly caused on screen produce restrained physical sound; there are no decorative hits or whooshes.',
    allowBackgroundPresence
      ? 'Background people create only indistinct nonverbal presence with no intelligible words, whispers, calls, laughter, humming, or singing.'
      : 'No background or unlisted person produces any voice, whisper, call, laugh, hum, song, or unexplained breath.',
    timedSpeech.length
      ? 'The tagged dialogue in the shot timeline is exhaustive: only one scheduled speaker vocalizes at a time, with no added, repeated, paraphrased, overlapping, or reassigned speech.'
      : 'No human vocalization occurs anywhere in the clip.',
  ].join(' ');
}

export function buildNonDiegeticMusic(storyboards: Storyboard[]): string {
  const music = [...new Set(storyboards.map(storyboard => storyboardAudioPlan(storyboard).music).filter(value => value && value !== 'none'))];
  return music.length
    ? `The audience-only score uses ${music.join('; ')}. It remains subordinate to dialogue and visibly caused sound.`
    : 'N/A';
}
