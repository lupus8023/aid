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

export function parseVideoDuplicates(raw: string, names: string[], closedCast = false): Pick<VideoDuplicateAudit, 'passed' | 'duplicates' | 'reason'> {
  const data = extractJson(raw) as any;
  if (Array.isArray(data?.observations)) {
    if (data.observations.length !== 3 || new Set(data.observations.map((o: any) => o.frame)).size !== 3) throw new Error('视频采样必须逐帧列出可见身体');
    const found = new Map<string, { name: string; frames: number[]; evidence: string }>();
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
    }
    data.duplicates = [...found.values()]; data.reviewedAllFrames = true;
  }
  if (!Array.isArray(data?.duplicates) || ![true, false].includes(data.reviewedAllFrames)) throw new Error('视频重复角色核验格式无效');
  const duplicates = data.duplicates.map((d: any) => {
    if (!(names.includes(d?.name) || (closedCast && d?.name === '__extra__')) || !Array.isArray(d.frames) || !d.frames.length || d.frames.some((n: unknown) => ![1, 2, 3].includes(Number(n))) || typeof d.evidence !== 'string' || !d.evidence.trim()) throw new Error('视频重复角色核验缺少可定位证据');
    return { name: d.name as string, frames: [...new Set<number>(d.frames.map(Number))], evidence: d.evidence.slice(0, 600) };
  });
  const confirmed = duplicates.some((d: { frames: number[] }) => d.frames.length >= 2);
  return { duplicates, passed: confirmed ? false : !data.reviewedAllFrames || duplicates.length ? null : true,
    reason: confirmed ? '多个视频采样帧出现同一角色的额外副本' : duplicates.length || !data.reviewedAllFrames ? '视频角色检查证据不足，需复核；不自动重生成' : '三个采样帧未发现明确的重复角色；不代表全片逐帧检查' };
}

export function prepareVideoDuplicateRepair(all: Storyboard[], group: Storyboard[], audit: VideoDuplicateAudit): Storyboard[] {
  const leader = group[0];
  if (!leader?.videoTaskId || leader.videoTaskId !== audit.taskId || leader.videoStatus !== 'completed' || audit.passed !== false || !audit.duplicates.some(d => d.frames.length >= 2)) throw new Error('视频角色纠错缺少当前任务的明确证据');
  const attempts = leader.videoDuplicateRepairAttempts || 0;
  if (attempts >= MAX_VIDEO_DUPLICATE_REPAIRS) throw new Error('视频角色重复纠错已达上限，保留所有原视频供复核');
  const names = [...new Set(audit.duplicates.filter(d => d.frames.length >= 2 && d.name !== '__extra__').map(d => d.name))];
  const correction = `Keep exactly one visible instance of each named character. ${names.length ? names.join(', ') : 'Each person'} must remain the same single body throughout this shot. A camera track or change of framing reveals the existing person, never a second copy or an added person. Do not crossfade between two versions of the same body. Preserve the approved image, all dialogue and the authored action.`;
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
