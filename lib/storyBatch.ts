import * as XLSX from '@e965/xlsx';
import type { CapturePreset, Character, ObjectItem, VisualStyle, VoiceAgeGroup, VoiceGender } from '@/types';
import type { BatchTaskStatus } from '@/lib/minimaxBatch';
import type { StoryAspectRatio } from '@/lib/storyAspectRatio';
import { DEFAULT_TARGET_SHOT_COUNT, normalizeTargetShotCount } from '@/lib/pipeline/shotCount';
import { DEFAULT_VISUAL_STYLE, normalizeVisualStyle } from '@/lib/promptArchitecture';
import { createProjectId } from '@/lib/projectIdentity';
import { DEFAULT_CAPTURE_PRESET, normalizeCapturePreset } from '@/lib/capturePresets';

export interface StoryBatchCharacter extends Omit<Character, 'imageFile'> {
  referenceImagePath?: string;
}

export interface StoryBatchObject extends Omit<ObjectItem, 'imageFile'> {
  referenceImagePath?: string;
}

export interface StoryBatchTask {
  id: string;
  rowNumber: number;
  sequence: string;
  enabled: boolean;
  projectKey: string;
  projectId: string;
  projectName: string;
  storyContent: string;
  language: 'zh' | 'en';
  targetShotCount: number;
  aspectRatio: StoryAspectRatio;
  visualStyle: VisualStyle;
  capturePreset: CapturePreset;
  outputName: string;
  maxRetries: number;
  note: string;
  characters: StoryBatchCharacter[];
  objects: StoryBatchObject[];
  status: BatchTaskStatus;
  stage?: string;
  error?: string;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
  resolvedVoiceIds?: Record<string, string>;
}

type HeaderMap = Map<string, number>;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.result !== undefined) return cellText(record.result);
    if (record.text !== undefined) return cellText(record.text);
  }
  return String(value).trim();
}

function normalizedHeader(value: unknown): string {
  return cellText(value).toLocaleLowerCase().replace(/[\s_\-\/]+/g, '');
}

function mapHeaders(rows: unknown[][], aliases: Record<string, string[]>, required: string[]): { row: number; columns: HeaderMap } {
  for (let index = 0; index < Math.min(20, rows.length); index += 1) {
    const columns = new Map<string, number>();
    (rows[index] || []).forEach((value, column) => {
      const header = normalizedHeader(value);
      for (const [key, names] of Object.entries(aliases)) {
        if (names.some(name => normalizedHeader(name) === header)) columns.set(key, column);
      }
    });
    if (required.every(key => columns.has(key))) return { row: index + 1, columns };
  }
  throw new Error(`找不到表头：至少需要 ${required.join('、')}`);
}

function rowsForSheet(workbook: XLSX.WorkBook, names: string[], required = true): unknown[][] {
  const sheetName = workbook.SheetNames.find(name => names.includes(normalizedHeader(name)));
  if (!sheetName) {
    if (!required) return [];
    throw new Error(`Excel 缺少工作表：${names[0]}`);
  }
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
}

function valueAt(row: unknown[], columns: HeaderMap, key: string): string {
  const column = columns.get(key);
  return column === undefined ? '' : cellText(row[column]);
}

function isEnabled(value: string): boolean {
  return !value || !['否', 'false', '0', 'no', 'n', '停用'].includes(value.toLocaleLowerCase());
}

function safeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!normalized) return '';
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`参考图必须位于项目文件夹内：${value}`);
  }
  return normalized;
}

function safeOutputName(value: string, fallback: string): string {
  const base = (value || fallback).replace(/\.mp4$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${base || fallback}.mp4`;
}

function normalizeGender(value: string): VoiceGender {
  const normalized = normalizedHeader(value);
  if (['女', '女性', 'female', 'woman'].includes(normalized)) return 'female';
  if (['男', '男性', 'male', 'man'].includes(normalized)) return 'male';
  if (['非二元', 'nonbinary'].includes(normalized)) return 'nonbinary';
  return 'unknown';
}

function normalizeAge(value: string): VoiceAgeGroup {
  const normalized = normalizedHeader(value);
  if (['儿童', '孩子', 'child'].includes(normalized)) return 'child';
  if (['青年', '年轻成人', 'youngadult', 'young'].includes(normalized)) return 'young_adult';
  if (['成人', '成年', 'adult'].includes(normalized)) return 'adult';
  if (['老年', '长者', 'senior', 'elderly'].includes(normalized)) return 'senior';
  return 'unknown';
}

const PROJECT_HEADERS = {
  sequence: ['序号', '编号', 'sequence'], enabled: ['启用', '执行', 'enabled'], projectKey: ['项目id', '项目编号', 'projectid'],
  projectName: ['项目名称', '片名', 'projectname'], storyContent: ['基础故事', '故事文案', '故事', 'story'], language: ['语言', 'language'],
  targetShotCount: ['分镜数', '镜头数', 'shotcount'], aspectRatio: ['画幅', '比例', 'aspectratio'], visualStyle: ['视觉风格', '风格', 'visualstyle'],
  capturePreset: ['拍摄方式', '拍摄预设', 'capturepreset', 'capturemode'],
  outputName: ['输出文件名', '文件名', 'output'], maxRetries: ['失败重试次数', '重试次数', 'retries'], note: ['备注', 'note'],
};
const CAST_HEADERS = {
  projectKey: ['项目id', '项目编号', 'projectid'], name: ['角色名称', '角色', 'character'], description: ['角色描述', '人物描述', 'description'],
  voiceId: ['fishvoiceid', 'fishid', '音色id', 'voiceid'], gender: ['性别', 'gender'], ageGroup: ['年龄', '年龄段', 'agegroup'],
  referenceImage: ['角色参考图', '参考图', 'referenceimage'],
};
const OBJECT_HEADERS = {
  projectKey: ['项目id', '项目编号', 'projectid'], name: ['物件名称', '物件', 'object'], description: ['物件描述', 'description'], referenceImage: ['物件参考图', '参考图', 'referenceimage'],
};

export async function parseStoryBatchWorkbook(data: ArrayBuffer): Promise<StoryBatchTask[]> {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const projectRows = rowsForSheet(workbook, ['projects', '项目', '项目表', 'story项目']);
  const castRows = rowsForSheet(workbook, ['cast', '角色', '角色表']);
  const objectRows = rowsForSheet(workbook, ['objects', '物件', '物件表'], false);
  const projectsHeader = mapHeaders(projectRows, PROJECT_HEADERS, ['projectKey', 'projectName', 'storyContent']);
  const castHeader = mapHeaders(castRows, CAST_HEADERS, ['projectKey', 'name', 'description']);
  const objectsHeader = objectRows.length ? mapHeaders(objectRows, OBJECT_HEADERS, ['projectKey', 'name', 'description']) : undefined;

  const charactersByProject = new Map<string, StoryBatchCharacter[]>();
  for (let index = castHeader.row; index < castRows.length; index += 1) {
    const row = castRows[index] || [];
    const projectKey = valueAt(row, castHeader.columns, 'projectKey');
    const name = valueAt(row, castHeader.columns, 'name');
    if (!projectKey && !name) continue;
    if (!projectKey || !name) throw new Error(`角色表第 ${index + 1} 行缺少项目 ID 或角色名称`);
    const imagePath = safeRelativePath(valueAt(row, castHeader.columns, 'referenceImage'));
    const character: StoryBatchCharacter = {
      id: `batch-character-${projectKey}-${charactersByProject.get(projectKey)?.length || 0}`,
      name,
      description: valueAt(row, castHeader.columns, 'description'),
      imageUrl: '',
      voiceId: valueAt(row, castHeader.columns, 'voiceId') || undefined,
      voiceSource: valueAt(row, castHeader.columns, 'voiceId') ? 'user' : 'auto',
      gender: normalizeGender(valueAt(row, castHeader.columns, 'gender')),
      ageGroup: normalizeAge(valueAt(row, castHeader.columns, 'ageGroup')),
      referenceImagePath: imagePath || undefined,
    };
    charactersByProject.set(projectKey, [...(charactersByProject.get(projectKey) || []), character]);
  }

  const objectsByProject = new Map<string, StoryBatchObject[]>();
  if (objectsHeader) {
    for (let index = objectsHeader.row; index < objectRows.length; index += 1) {
      const row = objectRows[index] || [];
      const projectKey = valueAt(row, objectsHeader.columns, 'projectKey');
      const name = valueAt(row, objectsHeader.columns, 'name');
      if (!projectKey && !name) continue;
      if (!projectKey || !name) throw new Error(`物件表第 ${index + 1} 行缺少项目 ID 或物件名称`);
      const imagePath = safeRelativePath(valueAt(row, objectsHeader.columns, 'referenceImage'));
      const object: StoryBatchObject = {
        id: `batch-object-${projectKey}-${objectsByProject.get(projectKey)?.length || 0}`,
        name,
        description: valueAt(row, objectsHeader.columns, 'description'),
        imageUrl: '',
        referenceImagePath: imagePath || undefined,
      };
      objectsByProject.set(projectKey, [...(objectsByProject.get(projectKey) || []), object]);
    }
  }

  const tasks: StoryBatchTask[] = [];
  const seen = new Set<string>();
  for (let index = projectsHeader.row; index < projectRows.length; index += 1) {
    const row = projectRows[index] || [];
    const projectKey = valueAt(row, projectsHeader.columns, 'projectKey');
    const projectName = valueAt(row, projectsHeader.columns, 'projectName');
    const storyContent = valueAt(row, projectsHeader.columns, 'storyContent');
    if (!projectKey && !projectName && !storyContent) continue;
    let error = '';
    if (!projectKey) error = '项目 ID 不能为空';
    else if (seen.has(projectKey)) error = `项目 ID 重复：${projectKey}`;
    else if (!projectName) error = '项目名称不能为空';
    else if (!storyContent) error = '基础故事不能为空';
    const characters = charactersByProject.get(projectKey) || [];
    if (!error && !characters.length) error = '角色表中至少需要一个同项目 ID 的角色';
    seen.add(projectKey);
    const sequence = valueAt(row, projectsHeader.columns, 'sequence') || String(tasks.length + 1);
    const enabled = isEnabled(valueAt(row, projectsHeader.columns, 'enabled'));
    const language = normalizedHeader(valueAt(row, projectsHeader.columns, 'language')) === 'en' ? 'en' : 'zh';
    const aspectValue = valueAt(row, projectsHeader.columns, 'aspectRatio');
    const aspectRatio = (['16:9', '9:16', '1:1'].includes(aspectValue) ? aspectValue : '16:9') as StoryAspectRatio;
    if (!error && aspectValue && !['16:9', '9:16', '1:1'].includes(aspectValue)) error = `不支持的画幅：${aspectValue}`;
    const targetShotCount = normalizeTargetShotCount(Number(valueAt(row, projectsHeader.columns, 'targetShotCount')) || DEFAULT_TARGET_SHOT_COUNT);
    const maxRetries = Math.min(5, Math.max(0, Math.round(Number(valueAt(row, projectsHeader.columns, 'maxRetries')) || 2)));
    tasks.push({
      id: `story-row-${index + 1}-${projectKey || sequence}`,
      rowNumber: index + 1,
      sequence,
      enabled,
      projectKey,
      projectId: createProjectId(),
      projectName,
      storyContent,
      language,
      targetShotCount,
      aspectRatio,
      visualStyle: normalizeVisualStyle((valueAt(row, projectsHeader.columns, 'visualStyle') || DEFAULT_VISUAL_STYLE) as VisualStyle),
      capturePreset: normalizeCapturePreset(valueAt(row, projectsHeader.columns, 'capturePreset') || DEFAULT_CAPTURE_PRESET),
      outputName: safeOutputName(valueAt(row, projectsHeader.columns, 'outputName'), projectName || `story-${sequence}`),
      maxRetries,
      note: valueAt(row, projectsHeader.columns, 'note'),
      characters,
      objects: objectsByProject.get(projectKey) || [],
      status: !enabled ? 'skipped' : error ? 'invalid' : 'pending',
      error: error || undefined,
      attempts: 0,
    });
  }
  if (!tasks.length) throw new Error('项目表中没有找到任务行');
  return tasks;
}

export function storyBatchOutputDirectory(task: StoryBatchTask): string {
  const safe = `${task.sequence}-${task.projectName}`.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return `story-output/${safe || task.projectKey}`;
}
