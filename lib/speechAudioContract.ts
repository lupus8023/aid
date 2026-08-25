import type { StoryAudioPlan, Storyboard, StorySpeechLine } from '@/types';

export const MAX_H3_SPEECH_TURNS = 3;

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
  silenceBefore: 0.9,
  silenceAfter: 1,
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
  /^(?:先)?(?:短暂|稍作|略作|片刻)?(?:停顿|沉默)(?:片刻|一下)?(?:，|,)?(?:再|然后)?(?:以|用)?[^。！？!?]{0,24}(?:语气|口吻)?(?:说|说道|开口|回答)(?:话)?[。.!！]?$/i,
  /^(?:以|用)[^。！？!?]{0,24}(?:语气|口吻)(?:说|说道|开口|回答)(?:话)?[。.!！]?$/i,
  /^(?:pause|hesitate)(?:\s+(?:briefly|for a moment))?(?:,?\s+then)?(?:\s+(?:say|speak|reply)(?:\s+in\s+an?\s+[\w -]+\s+(?:tone|voice))?)?[.!]?$/i,
];

const SPOKEN_WRAPPER_PATTERNS = [
  /^(?:先)?(?:短暂|稍作|略作|片刻)?(?:停顿|沉默)(?:片刻|一下)?(?:，|,)?(?:再|然后)?(?:以|用)?[^：“”\"。！？!?]{0,24}(?:语气|口吻)?(?:说|说道|开口|回答)\s*[:：，,]?\s*[“\"](.+?)[”\"]\s*[。.!！]?$/i,
  /^(?:以|用)[^：“”\"。！？!?]{0,24}(?:语气|口吻)(?:说|说道|开口|回答)\s*[:：，,]?\s*[“\"](.+?)[”\"]\s*[。.!！]?$/i,
  /^(?:after\s+)?(?:a\s+)?brief\s+pause,?\s+(?:then\s+)?(?:says?|speaks?|replies?)\s*(?:in\s+an?\s+[\w -]+\s+(?:tone|voice))?\s*[:：,]?\s*[“\"](.+?)[”\"]\s*[.!]?$/i,
];

/** Strip model-written performance prose while retaining only words the character actually says. */
export function sanitizeGeneratedSpeechText(value: unknown): string {
  let text = clean(value)
    .replace(/^[\[【（(]\s*(?:台词|对白|语音|speech|dialogue)\s*[\]】）)]\s*[:：-]?\s*/i, '')
    .replace(/^[\[【（(](?:停顿|沉默|坚定|犹豫|轻声|低声|大声|语气|口吻)[^\]】）)]{0,30}[\]】）)]\s*/i, '')
    .trim();
  for (const pattern of SPOKEN_WRAPPER_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      text = clean(match[1]);
      break;
    }
  }
  return isDirectingInstructionDialogue(text) ? '' : text;
}

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

function officialSpeakerId(value: unknown, character: string): string {
  const raw = clean(value) || stableSpeakerId(character);
  const match = raw.match(/^S0*(\d+)$/i);
  return match ? `S${Number(match[1])}` : raw;
}

const UNBOUND_VISIBLE_IDENTITY = /(?:一名|一个|一位|陌生的?|不知名的?)(?:年轻的?|年迈的?)?(?:少年|少女|男孩|女孩|男人|女人|男子|女子|老人|孩子|士兵|警察|医生|工人|路人|村民)|\b(?:a|an|another|unnamed|unknown)\s+(?:(?:young|old|teenage|elderly|middle-aged)\s+)?(?:boy|girl|man|woman|person|child|soldier|officer|doctor|worker|passerby|villager)\b/i;

/**
 * Structured `characters` is the cast authority. The action may naturally use
 * a translated role alias (e.g. “the mermaid princess” for 人鱼公主), so absence
 * of the exact library name is not itself an error. Only quarantine the line
 * when the prose explicitly introduces a different, unbound visible identity.
 */
export function generatedSpeakerMatchesVisibleAction(storyboard: Storyboard, line: StorySpeechLine): boolean {
  if (line.source === 'user_exact') return true;
  const action = clean(storyboard.action);
  if (!action) return true; // Legacy projects may not have preserved an action field.
  if (action.toLocaleLowerCase().includes(clean(line.character).toLocaleLowerCase())) return true;
  return !UNBOUND_VISIBLE_IDENTITY.test(action);
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
  const seen = new Set<string>();
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
        listenerState: '',
        storyFunction: '',
        respondsTo: '',
        contentGoal: '',
        source: 'story_required' as const,
      }));

  return source
    .map(line => ({
      ...line,
      speakerId: officialSpeakerId(line.speakerId, clean(line.character)),
      character: clean(line.character),
      exactLine: line.source === 'user_exact'
        ? clean(line.exactLine)
        : sanitizeGeneratedSpeechText(line.exactLine),
      emotion: clean(line.emotion) || 'restrained and scene-appropriate',
      delivery: clean(line.delivery) || 'natural, concise, no theatrical emphasis',
      volume: line.volume || 'normal',
      lipSync: line.lipSync !== false,
      listenerState: clean(line.listenerState),
      storyFunction: clean(line.storyFunction),
      respondsTo: clean(line.respondsTo),
      contentGoal: clean(line.contentGoal),
      source: line.source === 'user_exact' ? 'user_exact' as const : 'story_required' as const,
    }))
    .filter(line => line.character
      && line.exactLine
      && visible.has(line.character)
      && generatedSpeakerMatchesVisibleAction(storyboard, line)
      && (line.source === 'user_exact' || !isDirectingInstructionDialogue(line.exactLine))
      && !seen.has(`${line.character}\u0000${line.exactLine}`)
      && Boolean(seen.add(`${line.character}\u0000${line.exactLine}`)))
    // Keep exactly one overflow sentinel so validateSpeechContract can reject
    // a fourth turn explicitly. Slicing to MAX_H3_SPEECH_TURNS here would
    // silently delete the invalid turn before the validator can see it.
    .slice(0, MAX_H3_SPEECH_TURNS + 1);
}

export function storyboardSpeechWarnings(storyboard: Storyboard): string[] {
  const rawLines = storyboard.speech?.length
    ? storyboard.speech
    : (storyboard.dialogueLines || []).map(line => ({
        speakerId: stableSpeakerId(clean(line.character)),
        character: clean(line.character),
        exactLine: clean(line.text),
        emotion: '', delivery: '', volume: 'normal' as const, lipSync: true,
        source: 'story_required' as const,
      }));
  const visible = new Set(storyboard.characters || []);
  return rawLines.flatMap(line => {
    const exactLine = line.source === 'user_exact' ? clean(line.exactLine) : sanitizeGeneratedSpeechText(line.exactLine);
    if (!exactLine || isDirectingInstructionDialogue(exactLine)) return ['已拦截被误写成台词的导演/表演说明'];
    if (!visible.has(clean(line.character))) return [`已拦截未出场角色“${clean(line.character) || '未知'}”的台词`];
    const normalized = { ...line, character: clean(line.character), exactLine } as StorySpeechLine;
    if (!generatedSpeakerMatchesVisibleAction(storyboard, normalized)) return [`已拦截与画面动作不匹配的“${normalized.character}”台词`];
    return [];
  });
}

export function segmentSpeechSignature(storyboards: Storyboard[]): string {
  return JSON.stringify(storyboards.flatMap(storyboard => storyboardSpeech(storyboard).map(line => ({
    sceneNumber: storyboard.sceneNumber,
    speakerId: line.speakerId,
    character: line.character,
    exactLine: line.exactLine,
    voiceId: line.voiceId || '',
  }))));
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
  if (lines.length > MAX_H3_SPEECH_TURNS) return `一个 H3 片段最多安排 ${MAX_H3_SPEECH_TURNS} 条顺序台词，请拆成独立片段`;
  if (new Set(lines.map(line => line.character)).size > MAX_H3_SPEECH_TURNS) return `一个 H3 片段最多绑定 ${MAX_H3_SPEECH_TURNS} 个说话角色，请拆成独立片段`;
  const overlong = lines.find(line => speechSeconds(line.exactLine) > 11.5);
  if (overlong) return `台词过长，无法在 15 秒内保留开场留白和说后反应：${overlong.character}`;
  const overloadedStoryboard = storyboards.find(storyboard => {
    const shotLines = storyboardSpeech(storyboard);
    if (!shotLines.length) return false;
    const plan = storyboardAudioPlan(storyboard);
    const required = shotLines.reduce((sum, line) => sum + speechSeconds(line.exactLine), 0)
      + Math.max(0, shotLines.length - 1) * 0.35
      + Math.max(0.8, plan.silenceBefore)
      + Math.max(1, plan.silenceAfter);
    return required > 15;
  });
  if (overloadedStoryboard) return `镜头 ${overloadedStoryboard.sceneNumber} 的多轮台词合计超过 H3 15 秒，请在剧本改编阶段拆成相邻镜头`;
  return undefined;
}

export function validateVoiceBindings(storyboards: Storyboard[]): string | undefined {
  const missing = storyboards.flatMap(storyboardSpeech).find(line => !clean(line.voiceId));
  return missing ? `角色“${missing.character}”尚未锁定音色，不能生成对白` : undefined;
}

export function compileTimedSpeech(
  storyboards: Storyboard[],
  timeline: Array<{ start: number; end: number }>,
): TimedSpeechLine[] {
  const error = validateSpeechContract(storyboards);
  if (error) throw new Error(error);
  const timed: TimedSpeechLine[] = [];
  storyboards.forEach((storyboard, index) => {
    const lines = storyboardSpeech(storyboard);
    if (!lines.length) return;
    const range = timeline[index];
    const plan = storyboardAudioPlan(storyboard);
    const available = Math.max(0.8, range.end - range.start);
    const gap = lines.length > 1 ? 0.35 : 0;
    const speechDurations = lines.map(line => speechSeconds(line.exactLine));
    const totalSpeech = speechDurations.reduce((sum, seconds) => sum + seconds, 0) + gap * (lines.length - 1);
    const lead = Math.min(Math.max(0.8, plan.silenceBefore), Math.max(0.8, (available - totalSpeech) * 0.55));
    const tail = Math.min(Math.max(1, plan.silenceAfter), Math.max(0.8, available - lead - totalSpeech));
    if (lead + totalSpeech + tail > available + 0.05) {
      throw new Error(`镜头 ${storyboard.sceneNumber} 的台词时长不足，请拆分台词或延长该片段`);
    }
    let cursor = range.start + lead;
    lines.forEach((line, lineIndex) => {
      const start = cursor;
      const end = Math.min(range.end - tail, start + speechDurations[lineIndex]);
      if (end - start < Math.min(0.8, speechDurations[lineIndex] * 0.85)) {
        throw new Error(`镜头 ${storyboard.sceneNumber} 的第 ${lineIndex + 1} 条台词时长不足，请拆分台词或延长该片段`);
      }
      timed.push({ ...line, storyboardIndex: index, sceneNumber: storyboard.sceneNumber, start, end });
      cursor = end + gap;
    });
  });
  return timed;
}

export function buildAudioManifest(storyboards: Storyboard[], language: 'zh' | 'en' = 'en'): string {
  const plans = storyboards.map(storyboardAudioPlan);
  // Per-shot cues already preserve the specific sources. The overall H3 field
  // is a compact bed summary; an unbounded union can consume hundreds of
  // prompt characters and crowd out action/dialogue timing.
  const environment = [...new Set(plans.flatMap(plan => plan.environment))].slice(0, 4);
  const foley = [...new Set(plans.flatMap(plan => plan.foley))].slice(0, 4);
  const allowBackgroundPresence = plans.some(plan => plan.backgroundHuman === 'indistinct_nonverbal');
  if (language === 'zh') {
    return [
      environment.length
        ? `场景环境声包括：${environment.join('；')}。`
        : '持续保留安静、透视关系正确的场景底噪。',
      foley.length
        ? `物理动作声包括：${foley.join('；')}；每个声音只与画面中可见的成因同步。`
        : '只为画面中明确发生的接触生成克制的物理声音。',
      allowBackgroundPresence
        ? '背景人物只能形成低沉、模糊、不可辨词义的非语言人声。'
        : '没有背景人声。',
      '没有旁白、临时加词、歌唱或任何剧本外可辨识词语。',
      '最后 0.35 秒只保留干净稳定的场景底噪并自然收束；不得出现电子嘶声、静电、蜂鸣、数字残响或突兀断音。',
    ].join(' ');
  }
  return [
    environment.length
      ? `The location ambience consists of ${environment.join('; ')}.`
      : 'A quiet, perspective-correct location room tone continues underneath the visible action.',
    foley.length
      ? `Physical action sounds include ${foley.join('; ')}, synchronized to their visible causes.`
      : 'Restrained physical sounds follow only contacts visibly caused on screen.',
    allowBackgroundPresence
      ? 'Background people contribute only a low, indistinct nonverbal presence with no recognizable words.'
      : 'Background human voices are absent.',
    'No narration, ad-lib, singing, or unscripted intelligible words are present.',
    'The final 0.35 seconds retain only clean stable location tone and settle naturally; no electronic hiss, static, buzz, digital residue, or abrupt audio cut.',
  ].join(' ');
}

export function buildNonDiegeticMusic(storyboards: Storyboard[], language: 'zh' | 'en' = 'en'): string {
  const music = [...new Set(storyboards.map(storyboard => storyboardAudioPlan(storyboard).music).filter(value => value && value !== 'none'))];
  if (language === 'zh') {
    return music.length
      ? `观众可听见的非画内配乐使用：${music.join('；')}。配乐不得压过对白和画面动作造成的声音。`
      : '没有音乐。不得生成配乐、旋律、节奏底、广告短曲、歌唱、器乐演奏、音调铺底或音乐转场。';
  }
  return music.length
    ? `The audience-only score uses ${music.join('; ')}. It remains subordinate to dialogue and visibly caused sound.`
    : 'No music is present. No score, melody, rhythmic bed, jingle, singing, instrumental performance, tonal pad, or musical transition is generated.';
}
