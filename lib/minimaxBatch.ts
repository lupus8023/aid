import * as XLSX from '@e965/xlsx';

export type MiniMaxWorkflow = 'single_reference' | 'multi_reference' | 'first_last';
export type BatchTaskStatus =
  | 'pending'
  | 'invalid'
  | 'submitting'
  | 'generating'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface MiniMaxBatchTask {
  id: string;
  rowNumber: number;
  sequence: string;
  enabled: boolean;
  workflow: MiniMaxWorkflow;
  workflowSource: 'auto' | 'manual';
  mainImage: string;
  endFrame: string;
  referenceImages: string[];
  referenceAudios: string[];
  prompt: string;
  duration: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  outputName: string;
  maxRetries: number;
  note: string;
  status: BatchTaskStatus;
  error?: string;
  taskId?: string;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
}

const HEADER_ALIASES: Record<string, string[]> = {
  sequence: ['序号', '编号', 'id'],
  enabled: ['启用', '执行', 'enabled'],
  workflow: ['工作流', '模式', 'workflow'],
  mainImage: ['主图', '首图', '首帧', '图片1', 'image1'],
  endFrame: ['尾帧', '结束帧', 'endframe'],
  reference2: ['参考图2', '图片2', 'reference2'],
  reference3: ['参考图3', '图片3', 'reference3'],
  reference4: ['参考图4', '图片4', 'reference4'],
  reference5: ['参考图5', '图片5', 'reference5'],
  audio1: ['音频1', '声音1', 'audio1'],
  audio2: ['音频2', '声音2', 'audio2'],
  audio3: ['音频3', '声音3', 'audio3'],
  prompt: ['提示词', '描述', 'prompt'],
  duration: ['时长', '秒数', 'duration'],
  aspectRatio: ['画幅', '比例', 'aspectratio'],
  outputName: ['输出文件名', '文件名', 'output'],
  maxRetries: ['失败重试次数', '重试次数', 'retries'],
  note: ['备注', 'note'],
};

function normalizedHeader(value: unknown): string {
  return cellText(value).toLowerCase().replace(/[\s_\-\/]+/g, '');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.result !== undefined) return cellText(record.result);
    if (Array.isArray(record.richText)) {
      return record.richText.map(item => cellText((item as Record<string, unknown>).text)).join('').trim();
    }
    if (record.text !== undefined) return cellText(record.text);
    if (record.hyperlink !== undefined) return cellText(record.text || record.hyperlink);
  }
  return String(value).trim();
}

function isEnabled(value: string): boolean {
  if (!value) return true;
  return !['否', 'false', '0', 'no', 'n', '停用'].includes(value.toLowerCase());
}

function safeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!normalized) return '';
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`素材路径必须位于项目文件夹内：${value}`);
  }
  return normalized;
}

function safeOutputName(value: string, fallback: string): string {
  const base = (value || fallback).replace(/\.mp4$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${base || fallback}.mp4`;
}

function workflowFromRow(explicit: string, endFrame: string, references: string[]): { workflow: MiniMaxWorkflow; source: 'auto' | 'manual' } {
  const normalized = explicit.trim().toLowerCase().replace(/[\s_\-]+/g, '');
  const hasReferences = references.length > 0;
  const auto = !normalized || ['自动', 'auto'].includes(normalized);

  if (endFrame && hasReferences) throw new Error('尾帧和参考图2～5不能同时填写');
  if (auto) {
    if (endFrame) return { workflow: 'first_last', source: 'auto' };
    if (hasReferences) return { workflow: 'multi_reference', source: 'auto' };
    return { workflow: 'single_reference', source: 'auto' };
  }

  const aliases: Record<string, MiniMaxWorkflow> = {
    单图: 'single_reference',
    单图参考: 'single_reference',
    single: 'single_reference',
    singlereference: 'single_reference',
    多图: 'multi_reference',
    多图参考: 'multi_reference',
    multi: 'multi_reference',
    multireference: 'multi_reference',
    首尾帧: 'first_last',
    首尾: 'first_last',
    firstlast: 'first_last',
  };
  const workflow = aliases[normalized];
  if (!workflow) throw new Error(`不支持的工作流：${explicit}`);
  if (workflow === 'single_reference' && (endFrame || hasReferences)) throw new Error('单图工作流只能填写主图');
  if (workflow === 'multi_reference' && (!hasReferences || endFrame)) throw new Error('多图工作流至少填写参考图2，且不能填写尾帧');
  if (workflow === 'first_last' && (!endFrame || hasReferences)) throw new Error('首尾帧工作流必须填写尾帧，且不能填写参考图2～5');
  return { workflow, source: 'manual' };
}

export function workflowLabel(workflow: MiniMaxWorkflow): string {
  if (workflow === 'first_last') return '首尾帧';
  if (workflow === 'multi_reference') return '多图参考';
  return '单图参考';
}

export async function parseMiniMaxBatchWorkbook(data: ArrayBuffer): Promise<MiniMaxBatchTask[]> {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames.includes('批量任务') ? '批量任务' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Excel 中没有可读取的工作表');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });

  let headerRowNumber = 0;
  const headerColumns = new Map<string, number>();
  for (let rowIndex = 0; rowIndex < Math.min(20, rows.length); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const candidates = new Map<string, number>();
    row.forEach((value, columnIndex) => {
      const header = normalizedHeader(value);
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.some(alias => normalizedHeader(alias) === header)) candidates.set(key, columnIndex);
      }
    });
    if (candidates.has('mainImage') && candidates.has('prompt')) {
      headerRowNumber = rowIndex + 1;
      candidates.forEach((column, key) => headerColumns.set(key, column));
      break;
    }
  }
  if (!headerRowNumber) throw new Error('找不到表头；Excel 至少需要“主图”和“提示词”两列');

  const valueAt = (row: unknown[], key: string) => {
    const column = headerColumns.get(key);
    return column === undefined ? '' : cellText(row[column]);
  };

  const tasks: MiniMaxBatchTask[] = [];
  let emptyRows = 0;
  for (let rowNumber = headerRowNumber + 1; rowNumber <= rows.length; rowNumber += 1) {
    const row = rows[rowNumber - 1] || [];
    const rawMainImage = valueAt(row, 'mainImage');
    const rawPrompt = valueAt(row, 'prompt');
    const rawOutput = valueAt(row, 'outputName');
    if (!rawMainImage && !rawPrompt && !rawOutput) {
      emptyRows += 1;
      if (emptyRows >= 10) break;
      continue;
    }
    emptyRows = 0;

    const sequence = valueAt(row, 'sequence') || String(tasks.length + 1);
    const enabled = isEnabled(valueAt(row, 'enabled'));
    let error = '';
    let mainImage = '';
    let endFrame = '';
    let references: string[] = [];
    let audios: string[] = [];
    let workflow: MiniMaxWorkflow = 'single_reference';
    let workflowSource: 'auto' | 'manual' = 'auto';
    try {
      mainImage = safeRelativePath(rawMainImage);
      endFrame = safeRelativePath(valueAt(row, 'endFrame'));
      references = ['reference2', 'reference3', 'reference4', 'reference5']
        .map(key => safeRelativePath(valueAt(row, key)))
        .filter(Boolean);
      audios = ['audio1', 'audio2', 'audio3']
        .map(key => safeRelativePath(valueAt(row, key)))
        .filter(Boolean);
      const selection = workflowFromRow(valueAt(row, 'workflow'), endFrame, references);
      workflow = selection.workflow;
      workflowSource = selection.source;
      if (!mainImage) throw new Error('主图不能为空');
      if (!rawPrompt.trim()) throw new Error('提示词不能为空');
    } catch (rowError) {
      error = rowError instanceof Error ? rowError.message : String(rowError);
    }

    const parsedDuration = Number(valueAt(row, 'duration')) || 5;
    const duration = Math.round(parsedDuration);
    if (!error && (duration < 2 || duration > 15)) error = '时长必须为 2～15 秒';
    const rawAspectRatio = valueAt(row, 'aspectRatio') || '16:9';
    const aspectRatio = (['16:9', '9:16', '1:1'].includes(rawAspectRatio) ? rawAspectRatio : '16:9') as MiniMaxBatchTask['aspectRatio'];
    if (!error && rawAspectRatio && !['16:9', '9:16', '1:1'].includes(rawAspectRatio)) error = `不支持的画幅：${rawAspectRatio}`;
    const maxRetries = Math.min(3, Math.max(0, Math.round(Number(valueAt(row, 'maxRetries')) || 0)));
    const outputName = safeOutputName(rawOutput, `${String(sequence).padStart(3, '0')}-minimax-h3`);

    tasks.push({
      id: `row-${rowNumber}-${sequence}`,
      rowNumber,
      sequence,
      enabled,
      workflow,
      workflowSource,
      mainImage,
      endFrame,
      referenceImages: references,
      referenceAudios: audios,
      prompt: rawPrompt.trim(),
      duration,
      aspectRatio,
      outputName,
      maxRetries,
      note: valueAt(row, 'note'),
      status: !enabled ? 'skipped' : error ? 'invalid' : 'pending',
      error: error || undefined,
      attempts: 0,
    });
  }
  if (!tasks.length) throw new Error('Excel 中没有找到任务行');
  return tasks;
}
