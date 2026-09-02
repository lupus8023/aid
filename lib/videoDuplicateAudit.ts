import type { Storyboard } from '@/types';
import { extractJson } from './pipeline/json';

export type VideoDuplicateAudit = NonNullable<Storyboard['videoDuplicateAudit']>;
export const MAX_VIDEO_DUPLICATE_REPAIRS = 2;

export function videoDuplicateAuditContext(board: Pick<Storyboard, 'description' | 'videoDirection'>): string {
  return [board.description, board.videoDirection?.action, board.videoDirection?.camera, board.videoDirection?.detail, board.videoDirection?.ending]
    .filter(Boolean).join(' ');
}

export function videoDuplicateAuditScope(boards: Array<Pick<Storyboard, 'sceneNumber' | 'characters' | 'description' | 'videoDirection'>>): { names: string[]; context: string } {
  return {
    names: [...new Set(boards.flatMap(board => board.characters))],
    context: boards.map(board => `Shot ${board.sceneNumber}: ${videoDuplicateAuditContext(board)}`).join('\n'),
  };
}

export function videoHasClosedCast(context: string): boolean {
  const visible = context.replace(/\boff[ -]?screen\s+(?:crowd|people|voices|onlookers|guards)\b/gi, '');
  // This quota is deliberately conservative. A scene can name only its speaking
  // cast while explicitly staging unnamed creatures behind them; counting those
  // authored background heads as clones would buy a needless replacement clip.
  const authoredBackground = /\b(crowd|people|extras|attendants|clerks|guards|onlookers|audience|reporters|soldiers|waiting men|delegation|delegates|envoys?|emissar(?:y|ies)|sharks|citizens|nobles|servants|spectators|passengers|children|cleanup team|surrounding court)\b/i
    .test(visible)
    || /\b(?:court|team)\s+(?:freezes|stays|holds|waits|watches|moves|drags)\b/i.test(visible)
    || /\b(?:corridor|hall|room)\b[^.]{0,80}\bcrowded\b/i.test(visible)
    || /\b(?:visible|background|surrounding)\s+reactions?\b/i.test(visible)
    || /\b(?:room|hall|chamber|court|audience)\b[^.]{0,120}\b(?:reacts?|listens?|watches|watching|ripples?\s+with\s+(?:a\s+few\s+)?visible\s+reactions?)\b/i.test(visible)
    || /\b(?:line|row|rank|group)\s+of\s+[a-z-]+s\b/i.test(visible)
    || /\b[a-z-]+s\s+(?:stacked|standing|waiting|gathered|lined|arrayed)\b/i.test(visible)
    || /\b(?:behind|among|through|past)\s+(?:the\s+)?[a-z-]+s\b/i.test(visible);
  return !authoredBackground;
}

export function parseVideoDuplicates(raw: string, names: string[], closedCast = false): Pick<VideoDuplicateAudit, 'passed' | 'duplicates' | 'subtitles' | 'reason'> {
  const data = extractJson(raw) as any;
  if (Array.isArray(data?.observations)) {
    if (data.observations.length !== 3 || new Set(data.observations.map((o: any) => o.frame)).size !== 3) throw new Error('视频采样必须逐帧列出可见身体');
    const found = new Map<string, { name: string; frames: number[]; evidence: string }>();
    const subtitleFrames: number[] = [];
    const subtitleTexts: string[] = [];
    let subtitleEvidence = '';
    for (const observation of data.observations) {
      if (![1, 2, 3].includes(observation.frame) || !Array.isArray(observation.visible)) throw new Error('视频逐帧证据格式无效');
      for (const person of observation.visible) {
        if ((person.name !== null && !names.includes(person.name)) || typeof person.position !== 'string' || !person.position.trim() || typeof person.evidence !== 'string') throw new Error('视频逐帧身份或位置无效');
      }
      for (const name of names) {
        const bodies = observation.visible.filter((p: any) => p.name === name);
        if (bodies.length < 2 || new Set(bodies.map((p: any) => p.position)).size < 2) continue;
        const entry = found.get(name) || { name, frames: [], evidence: '' };
        entry.frames.push(observation.frame);
        entry.evidence += `Frame ${observation.frame}: ${bodies.map((p: any) => `${p.position}: ${p.evidence}`).join('; ')}. `;
        found.set(name, entry);
      }
      if (closedCast && observation.visible.length > names.length) {
        const entry = found.get('__extra__') || { name: '__extra__', frames: [], evidence: '' };
        entry.frames.push(observation.frame);
        entry.evidence += `Frame ${observation.frame}: ${observation.visible.length} separate bodies in a closed cast of ${names.length}; ${observation.visible.map((p: any) => `${p.position}: ${p.evidence}`).join('; ')}. `;
        found.set('__extra__', entry);
      }
      const readableText = observation.readableText ?? [];
      if (!Array.isArray(readableText)) throw new Error('视频逐帧文字证据格式无效');
      const overlays = readableText.filter((entry: any) => ['subtitle', 'caption', 'dialogue_overlay'].includes(entry?.kind));
      for (const entry of overlays) {
        if (typeof entry.text !== 'string' || !entry.text.trim() || typeof entry.position !== 'string' || !entry.position.trim() || typeof entry.evidence !== 'string' || !entry.evidence.trim()) throw new Error('视频逐帧字幕证据无效');
      }
      if (overlays.length) {
        subtitleFrames.push(observation.frame);
        subtitleTexts.push(...overlays.map((entry: any) => entry.text.trim()));
        subtitleEvidence += `Frame ${observation.frame}: ${overlays.map((entry: any) => `${entry.position}: ${entry.evidence}`).join('; ')}. `;
      }
    }
    data.duplicates = [...found.values()];
    data.subtitles = subtitleFrames.length ? [{
      text: [...new Set(subtitleTexts)].join(' / ').slice(0, 240),
      frames: [...new Set(subtitleFrames)],
      evidence: subtitleEvidence.slice(0, 800),
    }] : [];
    data.reviewedAllFrames = true;
  }
  if (!Array.isArray(data?.duplicates) || ![true, false].includes(data.reviewedAllFrames)) throw new Error('视频重复角色核验格式无效');
  const duplicates = data.duplicates.map((d: any) => {
    if (!(names.includes(d?.name) || (closedCast && d?.name === '__extra__')) || !Array.isArray(d.frames) || !d.frames.length || d.frames.some((n: unknown) => ![1, 2, 3].includes(Number(n))) || typeof d.evidence !== 'string' || !d.evidence.trim()) throw new Error('视频重复角色核验缺少可定位证据');
    return { name: d.name as string, frames: [...new Set<number>(d.frames.map(Number))], evidence: d.evidence.slice(0, 600) };
  });
  const subtitles = (Array.isArray(data.subtitles) ? data.subtitles : []).map((entry: any) => {
    if (typeof entry?.text !== 'string' || !entry.text.trim() || !Array.isArray(entry.frames) || !entry.frames.length || entry.frames.some((n: unknown) => ![1, 2, 3].includes(Number(n))) || typeof entry.evidence !== 'string' || !entry.evidence.trim()) throw new Error('视频字幕核验缺少可定位证据');
    return { text: entry.text.trim().slice(0, 240), frames: [...new Set<number>(entry.frames.map(Number))], evidence: entry.evidence.slice(0, 800) };
  });
  const confirmedDuplicate = duplicates.some((d: { frames: number[] }) => d.frames.length >= 2);
  const confirmedSubtitle = subtitles.some((entry: { frames: number[] }) => entry.frames.length >= 2);
  const suspicious = duplicates.length > 0 || subtitles.length > 0 || !data.reviewedAllFrames;
  return {
    duplicates,
    subtitles,
    passed: confirmedDuplicate || confirmedSubtitle ? false : suspicious ? null : true,
    reason: confirmedSubtitle
      ? '相邻视频采样帧确认出现烧录字幕或对白文字'
      : confirmedDuplicate
        ? '多个视频采样帧出现同一角色的额外副本'
        : suspicious
          ? '视频画面检查证据不足，需复核；不自动重生成'
          : '三个采样帧未发现明确的重复角色或烧录字幕；不代表全片逐帧检查',
  };
}

export function prepareVideoDuplicateRepair(all: Storyboard[], group: Storyboard[], audit: VideoDuplicateAudit): Storyboard[] {
  const leader = group[0];
  const confirmedDuplicates = audit.duplicates.some(d => d.frames.length >= 2);
  const confirmedSubtitles = (audit.subtitles || []).some(entry => entry.frames.length >= 2);
  if (!leader?.videoTaskId || leader.videoTaskId !== audit.taskId || leader.videoStatus !== 'completed' || audit.passed !== false || (!confirmedDuplicates && !confirmedSubtitles)) throw new Error('视频画面纠错缺少当前任务的明确证据');
  const attempts = leader.videoDuplicateRepairAttempts || 0;
  const names = [...new Set(audit.duplicates.filter(d => d.frames.length >= 2 && d.name !== '__extra__').map(d => d.name))];
  const castNames = [...new Set(group.flatMap(board => board.characters).filter(Boolean))];
  const hasExtraBody = audit.duplicates.some(d => d.frames.length >= 2 && d.name === '__extra__');
  // Projects produced before the exact-cast repair prompt used the vague
  // "Each person" wording for __extra__ findings. Permit one bounded migration
  // repair so an old checkpoint can benefit from the corrected constraint.
  const needsExactCastMigration = attempts >= MAX_VIDEO_DUPLICATE_REPAIRS
    && hasExtraBody
    && castNames.length > 0
    && !leader.videoDuplicateRepairPrompt?.includes('visible story-character bodies total');
  if (attempts >= MAX_VIDEO_DUPLICATE_REPAIRS && !needsExactCastMigration) throw new Error('视频画面自动纠错已达上限，保留所有原视频供复核');
  const castConstraint = hasExtraBody && castNames.length
    ? `Show exactly ${castNames.length} visible story-character bodies total: ${castNames.join(', ')}. No fourth body, background character, partial face, reflection, portrait, statue, or added person may appear.`
    : `${names.length ? names.join(', ') : 'Each named character'} must remain the same single body throughout this shot.`;
  const duplicateCorrection = confirmedDuplicates
    ? `Keep exactly one visible instance of each named character. ${castConstraint} A camera track or change of framing reveals the existing person, never a second copy or an added person. Do not crossfade between two versions of the same body.`
    : '';
  const subtitleCorrection = confirmedSubtitles
    ? '画面必须完全无字幕、无对白文字、无标题、无贴片、无气泡、无水印、无界面文字。对白只存在于音轨中。删除画面下方及画面中央的所有对白字样，不得用字幕底框、色块或遮挡物替代。'
    : '';
  const correction = `${duplicateCorrection} ${subtitleCorrection} Preserve the approved image, all spoken dialogue and the authored action.`.trim();
  const ids = new Set(group.map(b => b.id));
  return all.map(b => !ids.has(b.id) ? b : {
    ...b, videoStatus: 'pending', videoTaskId: undefined, videoUrl: undefined, videoSourceUrl: undefined,
    videoCacheKey: undefined, videoCacheStatus: undefined, videoCachedAt: undefined,
    videoSegmentId: undefined, videoSegmentStoryboardIds: undefined, videoGenerationSignature: undefined,
    videoDuplicateAudit: undefined, videoEndingAudit: undefined, videoEndingWarning: undefined,
    ...(b.id === leader.id ? {
      videoDuplicateRepairAttempts: attempts + 1, videoDuplicateRepairPrompt: correction,
      videoDuplicateHistory: [...(leader.videoDuplicateHistory || []), {
        taskId: audit.taskId, videoSourceUrl: leader.videoSourceUrl, videoCacheKey: leader.videoCacheKey,
        generationSignature: leader.videoGenerationSignature, audit,
      }],
    } : {}),
  });
}
