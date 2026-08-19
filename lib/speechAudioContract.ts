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
  if (lines.length > 1) return '为避免串台和混乱配音，一个 H3 生成片段只允许一条权威台词；系统应拆成独立片段';
  const line = lines[0];
  if (line && speechSeconds(line.exactLine) > 11.5) return `台词过长，无法在 15 秒内保留开场留白和说后反应：${line.character}`;
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
  const music = [...new Set(plans.map(plan => plan.music).filter(value => value && value !== 'none'))];
  const allowBackgroundPresence = plans.some(plan => plan.backgroundHuman === 'indistinct_nonverbal');
  const foreground = timedSpeech.length
    ? `${timedSpeech[0].speakerId}/${timedSpeech[0].character} only, exactly once in its scheduled interval; no words before or after.`
    : 'none.';
  return [
    `FOREGROUND SPEECH: ${foreground}`,
    `BACKGROUND HUMAN: ${allowBackgroundPresence ? 'indistinct nonverbal presence only; zero intelligible words, whispers, calls, laughter or singing.' : 'none; zero crowd voices, whispers, calls, laughter, humming, singing or breaths from unlisted people.'}`,
    `ENVIRONMENT: ${environment.length ? environment.join('; ') : 'quiet location room tone only.'}`,
    `FOLEY: ${foley.length ? foley.join('; ') : 'only contacts visibly caused on screen; no decorative hits or whooshes.'}`,
    `MUSIC: ${music.length ? music.join('; ') : 'none.'}`,
    `SILENCE: preserve the written pre-line and post-line reaction gaps; do not fill them with human vocalization.`,
    `AUTHORITY: this manifest and the timed speech schedule are exhaustive. Do not invent, paraphrase, repeat, overlap or reassign any speech or vocal sound.`,
  ].join('\n');
}
