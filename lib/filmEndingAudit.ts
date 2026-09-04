import type { Storyboard } from '@/types';
import { FILM_ENDING_SECONDS, isFilmEndingSegment } from './filmEnding';

export type FilmEndingAudit = NonNullable<Storyboard['videoEndingAudit']>;
const words = (s: string) => s.normalize('NFKC').toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:'[a-z]+)?|[\u4e00-\u9fff]/g) || [];

export const FILM_ENDING_ASR_SKIPPED_WARNING = '自动成片已跳过额外末镜 ASR 转写核验；保留原视频继续合成，不据此重复生成。结尾要求仍由生成提示词约束。';

/** Informational only: never invalidate a paid clip or relabel an old audit as passed. */
export function retainFilmEndingForDelivery(all: Storyboard[], group: Storyboard[]): Storyboard[] {
  if (!isFilmEndingSegment(all, group)) return all;
  const leader = all.find(b => b.id === group[0]?.id);
  if (!leader || leader.videoStatus !== 'completed' || leader.videoEndingWarning === FILM_ENDING_ASR_SKIPPED_WARNING) return all;
  return all.map(b => b.id === leader.id ? { ...b, videoEndingWarning: FILM_ENDING_ASR_SKIPPED_WARNING } : b);
}

function matchDialogue(expected: string, actual: string): number {
  const x = words(expected), y = words(actual);
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + Number(x[i - 1] !== y[j - 1]));
    prev = row;
  }
  return Math.max(0, 1 - prev[y.length] / Math.max(1, x.length));
}

export function evaluateFilmEnding(
  duration: number,
  expected: string,
  asr: { text?: unknown; segments?: Array<{ start?: unknown; end?: unknown; text?: unknown }> },
): Pick<FilmEndingAudit, 'passed' | 'transcript' | 'dialogueMatch' | 'lastSpeechEnd' | 'reason'> {
  if (!Number.isFinite(duration) || duration < FILM_ENDING_SECONDS || typeof asr.text !== 'string') throw new Error('末镜音频核验未返回有效时长或文本；保留原视频后重试核验');
  const transcript = asr.text.trim();
  const speech = (asr.segments || []).filter(s => typeof s.text === 'string' && s.text.trim());
  if (transcript && (!speech.length || speech.some(s => !Number.isFinite(s.start) || !Number.isFinite(s.end) || Number(s.end) < Number(s.start)))) {
    throw new Error('末镜转写缺少可靠时间戳；保留原视频后重试核验');
  }
  const lastSpeechEnd = Math.max(0, ...speech.map(s => Number(s.end)));
  const dialogueMatch = matchDialogue(expected, transcript);
  // Explicit diagnostics only; automatic production does not call ASR or gate delivery on it.
  const dialoguePresent = dialogueMatch >= 0.8;
  const quietEnding = lastSpeechEnd <= duration - FILM_ENDING_SECONDS - 0.1;
  const passed = dialoguePresent && quietEnding;
  return { passed, transcript, dialogueMatch, lastSpeechEnd,
    reason: !dialoguePresent ? '末镜转写与完整台词不匹配'
      : !quietEnding ? '末镜最后一秒仍包含可识别台词'
        : '末镜台词转写匹配，末尾至少一秒未识别到讲话（含时间戳余量）' };
}
