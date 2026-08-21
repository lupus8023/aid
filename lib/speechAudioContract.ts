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

const DIRECTING_LINE_PATTERNS = [
  /^(?:无|没有)(?:任何)?(?:其他)?(?:角色|人物|人)(?:在场|出现)?[。.!！]?$/i,
  /^(?:无人|没有人)(?:说话|发声|开口)[。.!！]?$/i,
  /^(?:其他|其余|所有|全部|全体)?(?:可见)?(?:角色|人物|人)(?:保持)?(?:沉默|安静|无声|不说话|不发声|闭嘴|闭口|没有台词|无台词)(?:反应|聆听)?[。.!！]?$/i,
  /^(?:无|没有)(?:对白|台词|旁白|人声|语音|说话声)[。.!！]?$/i,
  /^(?:所有|全部|其他|其余)?(?:可见)?(?:角色|人物)?(?:嘴巴|嘴|口型)(?:保持)?(?:闭合|关闭|不动)[。.!！]?$/i,
  /^(?:no|without)\s+(?:other\s+)?(?:character|characters|person|people|one)(?:\s+(?:is|are))?\s*(?:present|visible|speaking)?[.!]?$/i,
  /^(?:no one|nobody)\s+(?:speaks|talks|vocalizes)[.!]?$/i,
  /^(?:other|all|remaining)\s+(?:visible\s+)?(?:characters|people|persons)\s+(?:remain|stay|are)\s+(?:silent|quiet)[.!]?$/i,
  /^(?:no|without)\s+(?:dialogue|speech|narration|voice|voices|vocalization)[.!]?$/i,
  /^(?:all|other|remaining)\s+(?:visible\s+)?mouths?\s+(?:remain|stay|are)\s+closed[.!]?$/i,
];

/** Prevent stage directions from being performed as native H3 dialogue. */
export function isDirectingInstructionDialogue(value: unknown): boolean {
  const text = clean(value)
    .replace(/^[\[【（(]\s*(?:台词|对白|语音|speech|dialogue)\s*[\]】）)]\s*[:：-]?\s*/i, '')
    .trim();
  return Boolean(text) && DIRECTING_LINE_PATTERNS.some(pattern => pattern.test(text));
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
      listenerState: undefined,
      source: line.source === 'user_exact' ? 'user_exact' as const : 'story_required' as const,
    }))
    .filter(line => line.character
      && line.exactLine
      && visible.has(line.character)
      && (line.source === 'user_exact' || !isDirectingInstructionDialogue(line.exactLine)))
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

export function validateSpeechLanguage(storyboards: Storyboard[], language?: 'zh' | 'en'): string | undefined {
  if (!language) return undefined;
  const mismatch = storyboards
    .flatMap(storyboard => storyboardSpeech(storyboard).map(line => ({ storyboard, line })))
    .find(({ line }) => {
      if (line.source === 'user_exact') return false;
      const containsChinese = /[\u3400-\u9fff]/.test(line.exactLine);
      const containsEnglish = /[A-Za-z]/.test(line.exactLine);
      return language === 'en' ? containsChinese : containsEnglish && !containsChinese;
    });
  if (!mismatch) return undefined;
  const expected = language === 'en' ? 'English' : '中文';
  return `项目对白语言为 ${expected}，但镜头 ${mismatch.storyboard.sceneNumber} 的生成台词语言不一致：${mismatch.line.exactLine}`;
}

export function validateSpeechContract(storyboards: Storyboard[]): string | undefined {
  const lines = storyboards.flatMap(storyboardSpeech);
  const rawCount = storyboards.reduce((total, storyboard) => {
    const rawLines = storyboard.speech?.length
      ? storyboard.speech
      : storyboard.dialogueLines?.length
        ? storyboard.dialogueLines.map(line => ({ exactLine: line.text, source: 'story_required' as const }))
        : Object.values(storyboard.dialogue || {}).map(exactLine => ({ exactLine, source: 'story_required' as const }));
    return total + rawLines.filter(line => line.source === 'user_exact' || !isDirectingInstructionDialogue(line.exactLine)).length;
  }, 0);
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

export function buildAudioManifest(storyboards: Storyboard[]): string {
  const plans = storyboards.map(storyboardAudioPlan);
  const environment = [...new Set(plans.flatMap(plan => plan.environment))];
  const foley = [...new Set(plans.flatMap(plan => plan.foley))];
  const allowBackgroundPresence = plans.some(plan => plan.backgroundHuman === 'indistinct_nonverbal');
  return [
    environment.length
      ? `The location ambience consists of ${environment.join('; ')}.`
      : 'A quiet, perspective-correct location room tone continues underneath the visible action.',
    foley.length
      ? `Physical action sounds include ${foley.join('; ')}, synchronized to their visible causes.`
      : 'Restrained physical sounds follow only contacts visibly caused on screen.',
    allowBackgroundPresence
      ? 'Background people contribute a low, indistinct nonverbal presence.'
      : '',
  ].join(' ');
}

export function buildNonDiegeticMusic(storyboards: Storyboard[]): string {
  const music = [...new Set(storyboards.map(storyboard => storyboardAudioPlan(storyboard).music).filter(value => value && value !== 'none'))];
  return music.length
    ? `The audience-only score uses ${music.join('; ')}. It remains subordinate to dialogue and visibly caused sound.`
    : 'N/A';
}
