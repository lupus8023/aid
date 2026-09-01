import type { Storyboard } from '@/types';
import { FILM_ENDING_SECONDS, isFilmEndingSegment } from './filmEnding';

export type FilmEndingAudit = NonNullable<Storyboard['videoEndingAudit']>;
export const MAX_ENDING_REPAIRS = 2;
const words = (s: string) => s.normalize('NFKC').toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:'[a-z]+)?|[\u4e00-\u9fff]/g) || [];

/** The requested quiet tail is best-effort; it must not buy repeated takes or block a whole season. */
export function filmEndingDisposition(audit: FilmEndingAudit): 'passed' | 'warning' | 'repair-dialogue' {
  if (audit.passed) return 'passed';
  return audit.dialogueMatch >= 0.8 ? 'warning' : 'repair-dialogue';
}

export const FILM_ENDING_WARNING = '末镜台词转写匹配，但结尾未留足一秒无配音画面；保留完整台词与自然动作，不再为此重复生成。';

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
  // This is an ASR screening gate, not a claim of perfect transcription or listening QA.
  const dialoguePresent = dialogueMatch >= 0.8;
  const quietEnding = lastSpeechEnd <= duration - FILM_ENDING_SECONDS - 0.1;
  const passed = dialoguePresent && quietEnding;
  return { passed, transcript, dialogueMatch, lastSpeechEnd,
    reason: !dialoguePresent ? '末镜转写与完整台词不匹配'
      : !quietEnding ? '末镜最后一秒仍包含可识别台词'
        : '末镜台词转写匹配，末尾至少一秒未识别到讲话（含时间戳余量）' };
}

/** Only a completed, audited final segment may spend the persisted repair budget. */
export function prepareFilmEndingRepair(all: Storyboard[], group: Storyboard[], audit: FilmEndingAudit): Storyboard[] {
  if (!isFilmEndingSegment(all, group) || audit.passed) throw new Error('只可修复已确认未通过的整片末镜');
  if (filmEndingDisposition(audit) === 'warning') throw new Error('末镜仅留白不足，记录提示而不重生成');
  const leader = group[0];
  if (!leader?.videoTaskId || leader.videoTaskId !== audit.taskId || leader.videoStatus !== 'completed') throw new Error('末镜核验对应的视频任务已改变');
  const attempts = leader.videoEndingRepairAttempts || 0;
  const duration = Math.min(15, Math.ceil(Math.max(audit.duration, leader.videoDuration || 0) + 2));
  if (attempts >= MAX_ENDING_REPAIRS || duration <= Math.max(leader.videoDuration || 0, audit.duration)) {
    throw new Error('末镜台词仍未通过核验，已达到自动修复上限；所有台词和原视频已保留');
  }
  const ids = new Set(group.map(b => b.id));
  return all.map(b => !ids.has(b.id) ? b : {
    ...b,
    videoUrl: undefined, videoSourceUrl: undefined, videoTaskId: undefined,
    videoCacheKey: undefined, videoCacheStatus: undefined, videoCachedAt: undefined,
    videoStatus: 'pending', videoGenerationSignature: undefined,
    videoSegmentId: undefined, videoSegmentStoryboardIds: undefined,
    videoEndingAudit: undefined, videoEndingWarning: undefined,
    ...(b.id === leader.id ? {
      videoEndingRepairAttempts: attempts + 1,
      videoEndingMinimumDuration: duration,
      videoEndingHistory: [...(leader.videoEndingHistory || []), {
        taskId: audit.taskId, videoSourceUrl: leader.videoSourceUrl,
        videoCacheKey: leader.videoCacheKey, duration: audit.duration, reason: audit.reason,
      }],
    } : {}),
  });
}
