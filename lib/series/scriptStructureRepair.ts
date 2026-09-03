import type { SeriesProject } from './types';

export interface MissingSpeakerIssue {
  kind: 'missing_speaker';
  index: number;
  shotNumber: number;
  characterId: string;
  characterName: string;
}

export interface UngroundedObjectIssue {
  kind: 'ungrounded_object';
  index: number;
  shotNumber: number;
  objectId: string;
  objectName: string;
  aliases: string[];
  visual: string;
  action: string;
}

export type ScriptStructureIssue = MissingSpeakerIssue | UngroundedObjectIssue;

export interface ScriptStructureRepairLog {
  shotNumber: number;
  kind: 'speaker_added' | 'object_grounded' | 'object_removed' | 'shot_count_normalized';
  detail: string;
}

export class ScriptStructureError extends Error {
  constructor(public issues: ScriptStructureIssue[]) {
    const speakers = issues.filter(issue => issue.kind === 'missing_speaker');
    const objects = issues.filter(issue => issue.kind === 'ungrounded_object');
    const parts = [
      speakers.length ? `${speakers.length}处台词角色未登记为本镜发声角色（${speakers.map(issue => `第${issue.shotNumber}镜/${issue.characterName}`).join('、')}）` : '',
      objects.length ? `${objects.length}处固定道具引用与画面文字不一致（${objects.map(issue => `第${issue.shotNumber}镜/${issue.objectName}`).join('、')}）` : '',
    ].filter(Boolean);
    super(`镜头剧本需要反向校正：${parts.join('；')}`);
    this.name = 'ScriptStructureError';
  }
}

export function seriesScriptAssetFingerprint(project: SeriesProject, episode: SeriesProject['episodes'][number]) {
  return JSON.stringify({
    characters: project.characters
      .filter(character => episode.characterIds.includes(character.id))
      .map(({ id, name, role, description, appearance, speaking, bibleUrl }) => ({ id, name, role, description, appearance, speaking, bibleUrl })),
    locations: project.locations
      .filter(location => episode.locationIds.includes(location.id))
      .map(({ id, name, description, imageUrl }) => ({ id, name, description, imageUrl })),
    objects: (project.objects || []).map(({ id, name, aliases, description, imageUrl, referenceMode }) => ({
      id, name, aliases, description, imageUrl, referenceMode,
    })),
  });
}

export class ScriptShotCountError extends Error {
  constructor(public actual: number, public expected = 16) {
    super(`单集剧本返回${actual}镜，必须自动归并或拆分为${expected}镜`);
    this.name = 'ScriptShotCountError';
  }
}

export function applySafeSpeakerRepairs(raw: any, issues: ScriptStructureIssue[]) {
  const result = structuredClone(raw);
  const logs: ScriptStructureRepairLog[] = [];
  for (const issue of issues) {
    if (issue.kind !== 'missing_speaker') continue;
    const shot = result?.shots?.[issue.index];
    if (!shot || Number(shot.number) !== issue.shotNumber)
      throw new Error(`第${issue.shotNumber}镜结构已变化，不能自动补齐发声角色`);
    if (!Array.isArray(shot.characterIds)) shot.characterIds = [];
    if (!shot.characterIds.includes(issue.characterId)) {
      shot.characterIds.push(issue.characterId);
      logs.push({
        shotNumber: issue.shotNumber,
        kind: 'speaker_added',
        detail: `补入发声角色 ${issue.characterName}`,
      });
    }
  }
  return { raw: result, logs };
}

const normalized = (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';

export function applyObjectGroundingRepairs(
  raw: any,
  reply: any,
  issues: ScriptStructureIssue[],
) {
  const targets = issues.filter((issue): issue is UngroundedObjectIssue => issue.kind === 'ungrounded_object');
  const repairs = reply?.repairs;
  if (!Array.isArray(repairs) || repairs.length !== targets.length)
    throw new Error(`必须逐项处理全部${targets.length}处道具引用`);
  const result = structuredClone(raw);
  const allowed = new Map(targets.map(issue => [`${issue.shotNumber}:${issue.objectId}`, issue]));
  const logs: ScriptStructureRepairLog[] = [];
  for (const repair of repairs) {
    const key = `${Number(repair?.shotNumber)}:${String(repair?.objectId || '')}`;
    const issue = allowed.get(key);
    if (!issue) throw new Error('道具修稿包含未授权、重复或错误的镜头');
    const shot = result?.shots?.[issue.index];
    if (!shot || Number(shot.number) !== issue.shotNumber || !Array.isArray(shot.objectIds))
      throw new Error(`第${issue.shotNumber}镜结构已变化，不能应用道具修稿`);
    if (repair.decision === 'remove') {
      shot.objectIds = shot.objectIds.filter((id: unknown) => id !== issue.objectId);
      logs.push({
        shotNumber: issue.shotNumber,
        kind: 'object_removed',
        detail: `移除画面中未实际出现的 ${issue.objectName} 引用`,
      });
    } else if (repair.decision === 'ground') {
      if (!['visual', 'action'].includes(repair.field) || typeof repair.value !== 'string' || !repair.value.trim())
        throw new Error('保留道具时只能定点修正 visual 或 action');
      const names = [issue.objectName, ...issue.aliases].map(normalized).filter(Boolean);
      if (!names.some(name => normalized(repair.value).includes(name)))
        throw new Error(`第${issue.shotNumber}镜修稿仍未使用 ${issue.objectName} 的正名或登记别名`);
      const oldValue = String(shot[repair.field] || '');
      const value = repair.value.trim();
      if (value.length > Math.max(oldValue.length + 180, Math.ceil(oldValue.length * 1.8)))
        throw new Error(`第${issue.shotNumber}镜道具修稿改写范围过大`);
      shot[repair.field] = value;
      logs.push({
        shotNumber: issue.shotNumber,
        kind: 'object_grounded',
        detail: `将可见道具统一为 ${issue.objectName} 的登记名称`,
      });
    } else {
      throw new Error('每处道具只能选择 ground 或 remove');
    }
    allowed.delete(key);
  }
  if (allowed.size) throw new Error('有道具引用尚未处理');
  return { raw: result, logs };
}

const dialogueSignature = (shots: any[]) => JSON.stringify(shots.flatMap(shot =>
  (Array.isArray(shot?.dialogue) ? shot.dialogue : []).map((line: any) => ({
    characterId: line?.characterId,
    text: line?.text,
    emotion: line?.emotion,
  })),
));

export function applyShotCountRepair(raw: any, reply: any, project: SeriesProject) {
  if (!Array.isArray(reply?.shots) || reply.shots.length !== project.shotCount)
    throw new Error(`镜头归并修稿必须返回恰好${project.shotCount}镜`);
  const original = Array.isArray(raw?.shots) ? raw.shots : [];
  if (dialogueSignature(original) !== dialogueSignature(reply.shots))
    throw new Error('镜头归并不得删除、增加、改写或调序任何台词');
  const originalObjects = new Set(original.flatMap((shot: any) => Array.isArray(shot?.objectIds) ? shot.objectIds : []));
  const repairedObjects = new Set(reply.shots.flatMap((shot: any) => Array.isArray(shot?.objectIds) ? shot.objectIds : []));
  if ([...originalObjects].some(id => !repairedObjects.has(id)) || [...repairedObjects].some(id => !originalObjects.has(id)))
    throw new Error('镜头归并不得增加或提前删除固定道具线索');
  const allowedCharacters = new Set(project.characters.map(character => character.id));
  if (reply.shots.some((shot: any) => (shot.characterIds || []).some((id: unknown) => !allowedCharacters.has(String(id)))))
    throw new Error('镜头归并不得新增未登记角色');
  return {
    raw: { ...raw, shots: reply.shots },
    logs: [{
      shotNumber: 0,
      kind: 'shot_count_normalized' as const,
      detail: `将${original.length}镜归并或拆分为${project.shotCount}镜，保留全部原台词与固定道具线索`,
    }],
  };
}
