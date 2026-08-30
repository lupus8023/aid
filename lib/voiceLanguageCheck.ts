import { voiceReferenceSample } from './voiceReference';

export interface VoiceLanguageCheck {
  language: 'zh' | 'en';
  detectedLanguage?: string;
  matchScore: number;
  passed: boolean;
  reason: string;
}

function tokens(text: string, language: 'zh' | 'en'): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  return language === 'en' ? normalized.match(/[a-z]+(?:'[a-z]+)?/g) || [] : normalized.match(/[\p{L}\p{N}]/gu) || [];
}

export function checkVoiceTranscript(text: string, language: 'zh' | 'en', detectedLanguage?: string): VoiceLanguageCheck {
  const expected = tokens(voiceReferenceSample(language), language), actual = tokens(text, language);
  let previous = Array.from({ length: expected.length + 1 }, (_, i) => i);
  for (let row = 1; row <= actual.length; row++) {
    const current = [row];
    for (let col = 1; col <= expected.length; col++) current[col] = Math.min(current[col - 1] + 1, previous[col] + 1, previous[col - 1] + Number(actual[row - 1] !== expected[col - 1]));
    previous = current;
  }
  const matchScore = Math.max(0, 1 - previous[expected.length] / expected.length);
  const detected = detectedLanguage?.toLowerCase().split('-')[0];
  const wrongLanguage = !!detected && detected !== language && !(language === 'zh' && detected === 'cmn');
  const passed = !wrongLanguage && matchScore >= 0.7;
  return { language, detectedLanguage, matchScore, passed, reason: passed ? '目标语言试读与标准文本匹配（不代表演技或口音评分）' : wrongLanguage ? `试读语言为${detectedLanguage}，不符合${language}` : '试读漏读或错读过多，未通过文本匹配检查' };
}

export async function verifyFishVoiceLanguage(audio: Buffer, language: 'zh' | 'en', fishAudioKey: string): Promise<VoiceLanguageCheck> {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'voice.mp3');
  form.append('ignore_timestamps', 'true');
  // Do not force ASR into the expected language: detect what was actually said.
  const response = await fetch('https://api.fish.audio/v1/asr', {
    method: 'POST', headers: { Authorization: `Bearer ${fishAudioKey}` }, body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`试音转写服务暂不可用（${response.status}）；音频已保留，重试只补校验`);
  const data = await response.json();
  if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('试音转写未返回文本；音频已保留，重试只补校验');
  return checkVoiceTranscript(data.text.slice(0, 5000), language, typeof data.language_code === 'string' ? data.language_code : undefined);
}
