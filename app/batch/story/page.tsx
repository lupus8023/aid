'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  XCircle,
} from 'lucide-react';
import SettingsModal from '@/components/SettingsModal';
import { useSettings } from '@/hooks/useSettings';
import { comfyUIApiUrl, localComfyUISettings } from '@/lib/comfyuiClient';
import type { BatchTaskStatus } from '@/lib/minimaxBatch';
import {
  parseStoryBatchWorkbook,
  storyBatchOutputDirectory,
  type StoryBatchCharacter,
  type StoryBatchObject,
  type StoryBatchTask,
} from '@/lib/storyBatch';

const STATUS_LABELS: Record<BatchTaskStatus, string> = {
  pending: '等待中', invalid: '需要修正', submitting: '准备项目', generating: '自动生产中',
  downloading: '保存成片', completed: '已完成', failed: '失败', skipped: '已跳过',
};
const ACTIVE_STATUSES = new Set<BatchTaskStatus>(['submitting', 'generating', 'downloading']);
const CURRENT_PROJECT_KEY = 'aid:current-project:v2';
const LEGACY_PROJECT_KEY = 'currentProject';
const AUTO_PRODUCTION_KEY = 'aid:auto-production';

type BatchBridgeMessage = {
  type: 'aid-story-batch';
  runId: string;
  event: 'progress' | 'completed' | 'failed';
  stage?: string;
  error?: string;
  blob?: Blob;
  project?: unknown;
  fileName?: string;
  jobId?: string;
};

type PendingRun = {
  runId: string;
  taskId: string;
  resolve: (message: BatchBridgeMessage) => void;
  reject: (error: Error) => void;
  timer: number;
};

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function getFileHandleAtPath(root: FileSystemDirectoryHandle, relativePath: string): Promise<FileSystemFileHandle> {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) throw new Error(`无效路径：${relativePath}`);
  let directory = root;
  for (const segment of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
  return await directory.getFileHandle(parts.at(-1)!);
}

async function readProjectFile(root: FileSystemDirectoryHandle, relativePath: string): Promise<File> {
  return await (await getFileHandleAtPath(root, relativePath)).getFile();
}

async function writeProjectFile(root: FileSystemDirectoryHandle, relativePath: string, data: Blob | string): Promise<void> {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) throw new Error(`无效输出路径：${relativePath}`);
  let directory = root;
  for (const segment of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(segment, { create: true });
  const handle = await directory.getFileHandle(parts.at(-1)!, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

async function responseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.error || `请求失败 (${response.status})`;
  } catch {
    return `请求失败 (${response.status})`;
  }
}

async function findWorkbook(root: FileSystemDirectoryHandle): Promise<FileSystemFileHandle> {
  const candidates: FileSystemFileHandle[] = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === 'file' && /\.xlsx$/i.test(name) && !name.startsWith('~$')) candidates.push(handle as FileSystemFileHandle);
  }
  if (!candidates.length) throw new Error('项目文件夹根目录中没有找到 .xlsx 任务表');
  return candidates.sort((left, right) => {
    const score = (name: string) => /^(aid-story|story|故事批量|批量故事)/i.test(name) ? 0 : 1;
    return score(left.name) - score(right.name) || left.name.localeCompare(right.name);
  })[0];
}

function elapsedLabel(task: StoryBatchTask, now: number): string {
  if (!task.startedAt) return '—';
  const seconds = Math.max(0, Math.floor(((task.finishedAt || now) - task.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
}

function statusColor(status: BatchTaskStatus): string {
  if (status === 'completed') return 'text-[var(--success)] border-[var(--success)]/40 bg-[var(--success)]/5';
  if (status === 'failed' || status === 'invalid') return 'text-[var(--error)] border-[var(--error)]/40 bg-[var(--error)]/5';
  if (ACTIVE_STATUSES.has(status)) return 'text-[var(--accent-blue)] border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/5';
  return 'text-[var(--text-secondary)] border-[var(--border-color)] bg-[var(--bg-tertiary)]';
}

export default function StoryBatchPage() {
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [projectHandle, setProjectHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const projectHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [projectName, setProjectName] = useState('');
  const [workbookName, setWorkbookName] = useState('');
  const workbookNameRef = useRef('');
  const [tasks, setTasks] = useState<StoryBatchTask[]>([]);
  const tasksRef = useRef<StoryBatchTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState('请选择包含 Excel 和可选参考图的项目文件夹');
  const [now, setNow] = useState(Date.now());
  const [runnerUrl, setRunnerUrl] = useState('');
  const runnerRef = useRef<HTMLIFrameElement | null>(null);
  const pendingRunRef = useRef<PendingRun | undefined>(undefined);
  const pauseAfterCurrentRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const persistTasks = useCallback(async (nextTasks: StoryBatchTask[]) => {
    const root = projectHandleRef.current;
    if (!root) return;
    const snapshot = {
      version: 1,
      workbook: workbookNameRef.current,
      updatedAt: new Date().toISOString(),
      tasks: nextTasks.map(task => ({
        id: task.id, projectKey: task.projectKey, projectId: task.projectId, status: task.status,
        stage: task.stage, outputName: task.outputName, attempts: task.attempts, error: task.error,
        startedAt: task.startedAt, finishedAt: task.finishedAt, resolvedVoiceIds: task.resolvedVoiceIds,
      })),
    };
    const csvRows = [
      ['序号', 'Excel行', '项目ID', '项目名称', '状态', '当前阶段', '输出文件', '尝试次数', '开始时间', '完成时间', '错误'],
      ...nextTasks.map(task => [
        task.sequence, task.rowNumber, task.projectKey, task.projectName, STATUS_LABELS[task.status], task.stage || '',
        task.outputName, task.attempts, task.startedAt ? new Date(task.startedAt).toISOString() : '',
        task.finishedAt ? new Date(task.finishedAt).toISOString() : '', task.error || '',
      ]),
    ];
    await Promise.all([
      writeProjectFile(root, 'story-batch-status.json', JSON.stringify(snapshot, null, 2)),
      writeProjectFile(root, 'story-batch-log.csv', `\uFEFF${csvRows.map(row => row.map(csvCell).join(',')).join('\n')}`),
    ]);
  }, []);

  const schedulePersist = useCallback((nextTasks: StoryBatchTask[]) => {
    persistQueueRef.current = persistQueueRef.current
      .catch(() => undefined)
      .then(() => persistTasks(nextTasks))
      .catch(error => console.error('保存 Story 批量进度失败:', error));
  }, [persistTasks]);

  const commitTasks = useCallback((updater: (current: StoryBatchTask[]) => StoryBatchTask[]) => {
    const next = updater(tasksRef.current);
    tasksRef.current = next;
    setTasks(next);
    schedulePersist(next);
    return next;
  }, [schedulePersist]);

  const updateTask = useCallback((id: string, patch: Partial<StoryBatchTask>) => {
    return commitTasks(current => current.map(task => task.id === id ? { ...task, ...patch } : task));
  }, [commitTasks]);

  const persistActiveProject = useCallback(async (taskId: string, project?: unknown) => {
    const root = projectHandleRef.current;
    const task = tasksRef.current.find(item => item.id === taskId);
    if (!root || !task) return;
    let payload = project;
    if (!payload) {
      try { payload = JSON.parse(localStorage.getItem(CURRENT_PROJECT_KEY) || 'null'); } catch {}
    }
    if (payload) await writeProjectFile(root, `${storyBatchOutputDirectory(task)}/project.json`, JSON.stringify(payload, null, 2));
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent<BatchBridgeMessage>) => {
      if (event.origin !== window.location.origin || event.source !== runnerRef.current?.contentWindow) return;
      const pending = pendingRunRef.current;
      const data = event.data;
      if (!pending || data?.type !== 'aid-story-batch' || data.runId !== pending.runId) return;
      if (data.event === 'progress') {
        updateTask(pending.taskId, { status: 'generating', stage: data.stage || '自动生产中', error: undefined });
        void persistActiveProject(pending.taskId);
        return;
      }
      window.clearTimeout(pending.timer);
      pendingRunRef.current = undefined;
      setRunnerUrl('');
      if (data.event === 'completed') pending.resolve(data);
      else pending.reject(new Error(data.error || 'Story 自动生产失败'));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [persistActiveProject, updateTask]);

  const validateAssets = useCallback(async (root: FileSystemDirectoryHandle, parsed: StoryBatchTask[]) => {
    const checked: StoryBatchTask[] = [];
    for (const task of parsed) {
      if (!task.enabled || task.status === 'invalid') { checked.push(task); continue; }
      try {
        const paths = [
          ...task.characters.map(character => character.referenceImagePath),
          ...task.objects.map(object => object.referenceImagePath),
        ].filter((value): value is string => Boolean(value));
        for (const path of paths) {
          const file = await readProjectFile(root, path);
          if (file.size > 8 * 1024 * 1024) throw new Error(`${path} 超过 8MB`);
        }
        checked.push(task);
      } catch (error) {
        checked.push({ ...task, status: 'invalid', error: `素材检查失败：${error instanceof Error ? error.message : '未知错误'}` });
      }
    }
    return checked;
  }, []);

  const restoreProgress = useCallback(async (root: FileSystemDirectoryHandle, parsed: StoryBatchTask[]) => {
    try {
      const saved = JSON.parse(await (await readProjectFile(root, 'story-batch-status.json')).text()) as { tasks?: Array<Partial<StoryBatchTask> & { projectKey: string }> };
      const byKey = new Map((saved.tasks || []).map(task => [task.projectKey, task]));
      return parsed.map<StoryBatchTask>(task => {
        const prior = byKey.get(task.projectKey);
        if (!prior || task.status === 'invalid' || task.status === 'skipped') return task;
        const restoredStatus: BatchTaskStatus = prior.status === 'completed'
          ? 'completed'
          : prior.status === 'failed'
            ? 'failed'
            : 'pending';
        return {
          ...task,
          projectId: prior.projectId || task.projectId,
          status: restoredStatus,
          stage: prior.stage,
          attempts: Number(prior.attempts) || 0,
          error: prior.error,
          startedAt: prior.startedAt,
          finishedAt: prior.finishedAt,
          resolvedVoiceIds: prior.resolvedVoiceIds,
        };
      });
    } catch {
      return parsed;
    }
  }, []);

  const openProjectFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) { setMessage('当前浏览器不支持文件夹读写，请使用桌面版 Chrome 或 Edge'); return; }
    setIsLoading(true);
    try {
      const root = await window.showDirectoryPicker({ id: 'aid-story-batch', mode: 'readwrite' });
      const workbookHandle = await findWorkbook(root);
      const workbookFile = await workbookHandle.getFile();
      const parsed = await parseStoryBatchWorkbook(await workbookFile.arrayBuffer());
      const validated = await validateAssets(root, parsed);
      const restored = await restoreProgress(root, validated);
      projectHandleRef.current = root;
      setProjectHandle(root);
      setProjectName(root.name);
      setWorkbookName(workbookHandle.name);
      workbookNameRef.current = workbookHandle.name;
      tasksRef.current = restored;
      setTasks(restored);
      const executable = restored.filter(task => ['pending', 'failed'].includes(task.status)).length;
      const invalid = restored.filter(task => task.status === 'invalid').length;
      setMessage(`已读取 ${restored.length} 个 Story 项目，可执行 ${executable} 个${invalid ? `，${invalid} 个需要修正` : ''}`);
      schedulePersist(restored);
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') setMessage(error instanceof Error ? error.message : '读取项目文件夹失败');
    } finally {
      setIsLoading(false);
    }
  }, [restoreProgress, schedulePersist, validateAssets]);

  const resolveCharacterVoices = useCallback(async (task: StoryBatchTask): Promise<StoryBatchCharacter[]> => {
    if (!settings.fishAudioKey) throw new Error('请先在设置中配置 Fish Audio API Key');
    const used = new Set<string>();
    const resolved: StoryBatchCharacter[] = [];
    for (const character of task.characters) {
      const persisted = task.resolvedVoiceIds?.[character.name];
      const existing = character.voiceId || persisted;
      if (existing) {
        used.add(existing);
        resolved.push({ ...character, voiceId: existing, voiceSource: character.voiceId ? 'user' : 'auto' });
        continue;
      }
      const response = await fetch('/api/fish-voice/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishAudioKey: settings.fishAudioKey, language: task.language, character }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const selection = await response.json() as { voiceId?: string; voiceProfile?: string };
      if (!selection.voiceId) throw new Error(`角色“${character.name}”自动选声没有返回 Fish ID`);
      if (used.has(selection.voiceId)) {
        console.warn(`Fish 自动选声为多个角色返回相同音色：${selection.voiceId}`);
      }
      used.add(selection.voiceId);
      resolved.push({
        ...character,
        voiceId: selection.voiceId,
        voiceProfile: selection.voiceProfile || 'Fish 自动选声',
        // Mark the discovered id as locked so Story's curated fallback does
        // not replace it during screenplay generation.
        voiceSource: 'user',
      });
    }
    return resolved;
  }, [settings.fishAudioKey]);

  const hydrateCharacter = useCallback(async (root: FileSystemDirectoryHandle, character: StoryBatchCharacter): Promise<StoryBatchCharacter> => {
    if (!character.referenceImagePath) return character;
    const dataUrl = await fileToDataUrl(await readProjectFile(root, character.referenceImagePath));
    return { ...character, imageUrl: dataUrl, imageBase64: dataUrl };
  }, []);

  const hydrateObject = useCallback(async (root: FileSystemDirectoryHandle, object: StoryBatchObject): Promise<StoryBatchObject> => {
    if (!object.referenceImagePath) return object;
    const dataUrl = await fileToDataUrl(await readProjectFile(root, object.referenceImagePath));
    return { ...object, imageUrl: dataUrl, imageBase64: dataUrl };
  }, []);

  const loadSavedProject = useCallback(async (root: FileSystemDirectoryHandle, task: StoryBatchTask): Promise<Record<string, unknown> | undefined> => {
    try {
      const saved = JSON.parse(await (await readProjectFile(root, `${storyBatchOutputDirectory(task)}/project.json`)).text()) as Record<string, unknown>;
      return saved.id === task.projectId ? saved : undefined;
    } catch {
      return undefined;
    }
  }, []);

  const startRunner = useCallback(async (task: StoryBatchTask, project: Record<string, unknown>): Promise<BatchBridgeMessage> => {
    localStorage.setItem(CURRENT_PROJECT_KEY, JSON.stringify(project));
    localStorage.setItem(LEGACY_PROJECT_KEY, JSON.stringify(project));
    localStorage.setItem(AUTO_PRODUCTION_KEY, JSON.stringify({ projectId: task.projectId, status: 'running', updatedAt: Date.now() }));
    const runId = `${task.projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return await new Promise<BatchBridgeMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (pendingRunRef.current?.runId === runId) pendingRunRef.current = undefined;
        reject(new Error('Story 自动生产超过 12 小时，已停止本次监控；项目断点已保留'));
      }, 12 * 60 * 60 * 1000);
      pendingRunRef.current = { runId, taskId: task.id, resolve, reject, timer };
      setRunnerUrl(`/story?batchRunId=${encodeURIComponent(runId)}&stageRetries=3`);
    });
  }, []);

  const executeTask = useCallback(async (id: string, reset = false) => {
    if (reset) updateTask(id, { status: 'pending', stage: undefined, error: undefined, attempts: 0, startedAt: undefined, finishedAt: undefined });
    while (true) {
      let task = tasksRef.current.find(item => item.id === id);
      if (!task || task.status === 'invalid' || task.status === 'skipped' || task.status === 'completed') return;
      if (task.attempts > task.maxRetries) return;
      const root = projectHandleRef.current;
      if (!root) throw new Error('项目文件夹连接已丢失，请重新选择');
      try {
        const attempts = task.attempts + 1;
        updateTask(id, { status: 'submitting', stage: '准备项目与自动选择 Fish 音色', error: undefined, attempts, startedAt: task.startedAt || Date.now(), finishedAt: undefined });
        const voices = await resolveCharacterVoices(task);
        const resolvedVoiceIds = Object.fromEntries(voices.map(character => [character.name, character.voiceId || '']));
        updateTask(id, { resolvedVoiceIds, stage: '读取角色与物件参考图' });
        task = { ...task, attempts, characters: voices, resolvedVoiceIds };
        const [characters, objects, savedProject] = await Promise.all([
          Promise.all(voices.map(character => hydrateCharacter(root, character))),
          Promise.all(task.objects.map(object => hydrateObject(root, object))),
          loadSavedProject(root, task),
        ]);
        const timestamp = new Date().toISOString();
        const project = savedProject || {
          id: task.projectId,
          name: task.projectName,
          characters,
          objects,
          storyContent: task.storyContent,
          language: task.language,
          targetShotCount: task.targetShotCount,
          aspectRatio: task.aspectRatio,
          visualStyle: task.visualStyle,
          capturePreset: task.capturePreset,
          storyOutline: '',
          storyboards: [],
          voiceReferences: {},
          costumeImages: {},
          sceneImages: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        updateTask(id, { status: 'generating', stage: savedProject ? '从项目断点继续自动生产' : '编剧与分镜开始' });
        const result = await startRunner(task, project);
        if (!(result.blob instanceof Blob) || !result.blob.size) throw new Error('Story 已完成，但没有收到可保存的成片');
        updateTask(id, { status: 'downloading', stage: '写入成片和项目档案' });
        const directory = storyBatchOutputDirectory(task);
        await Promise.all([
          writeProjectFile(root, `${directory}/${task.outputName}`, result.blob),
          persistActiveProject(id, result.project),
        ]);
        updateTask(id, { status: 'completed', stage: '成片已保存', error: undefined, finishedAt: Date.now() });
        return;
      } catch (error) {
        const latest = tasksRef.current.find(item => item.id === id);
        if (!latest) return;
        const errorMessage = error instanceof Error ? error.message : 'Story 自动生产失败';
        localStorage.setItem(AUTO_PRODUCTION_KEY, JSON.stringify({ projectId: latest.projectId, status: 'paused', updatedAt: Date.now() }));
        await persistActiveProject(id).catch(() => undefined);
        if (latest.attempts <= latest.maxRetries) {
          updateTask(id, { status: 'pending', stage: '准备从断点自动重试', error: `${errorMessage}；准备重试` });
          await new Promise(resolve => window.setTimeout(resolve, 3000));
          continue;
        }
        updateTask(id, { status: 'failed', stage: '已停止', error: errorMessage, finishedAt: Date.now() });
        return;
      }
    }
  }, [hydrateCharacter, hydrateObject, loadSavedProject, persistActiveProject, resolveCharacterVoices, startRunner, updateTask]);

  const verifyEnvironment = useCallback(async () => {
    if (!settings.fishAudioKey) throw new Error('请先在设置中配置 Fish Audio API Key');
    if (!settings.apiKey && !settings.dmxApiKey) throw new Error('请先配置剧本生成所需的 APIMart 或 DMX API Key');
    const response = await fetch(comfyUIApiUrl('/api/comfyui/test', settings.comfyui), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: localComfyUISettings(settings.comfyui) }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'ComfyUI 连接测试失败');
  }, [settings]);

  const runQueue = useCallback(async () => {
    if (!projectHandle || isRunning) return;
    const runnable = tasksRef.current.filter(task => ['pending', 'failed'].includes(task.status));
    if (!runnable.length) { setMessage('没有等待执行的 Story 项目'); return; }
    setIsRunning(true);
    pauseAfterCurrentRef.current = false;
    setMessage('正在检查 API、Companion 和 ComfyUI…');
    try {
      await verifyEnvironment();
      setMessage('Story 批量生产已开始，将按 Excel 顺序逐个完成并合并');
      for (const queued of tasksRef.current) {
        const current = tasksRef.current.find(task => task.id === queued.id);
        if (!current || !['pending', 'failed'].includes(current.status)) continue;
        await executeTask(current.id, current.status === 'failed');
        if (pauseAfterCurrentRef.current) { setMessage('已在当前 Story 成片保存后暂停'); break; }
      }
      if (!pauseAfterCurrentRef.current) setMessage('本轮 Story 批量任务处理完毕');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Story 批量生产启动失败');
    } finally {
      setIsRunning(false);
    }
  }, [executeTask, isRunning, projectHandle, verifyEnvironment]);

  const runSingle = useCallback(async (id: string) => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      await verifyEnvironment();
      const task = tasksRef.current.find(item => item.id === id);
      await executeTask(id, task?.status === 'failed' || task?.status === 'completed');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Story 项目启动失败');
    } finally {
      setIsRunning(false);
    }
  }, [executeTask, isRunning, verifyEnvironment]);

  const downloadOutputCopy = useCallback(async (task: StoryBatchTask) => {
    const root = projectHandleRef.current;
    if (!root) return;
    try {
      const file = await readProjectFile(root, `${storyBatchOutputDirectory(task)}/${task.outputName}`);
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = task.outputName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取本地成片失败');
    }
  }, []);

  const stats = useMemo(() => ({
    total: tasks.filter(task => task.status !== 'skipped').length,
    completed: tasks.filter(task => task.status === 'completed').length,
    active: tasks.filter(task => ACTIVE_STATUSES.has(task.status)).length,
    waiting: tasks.filter(task => task.status === 'pending').length,
    failed: tasks.filter(task => task.status === 'failed' || task.status === 'invalid').length,
  }), [tasks]);
  const progress = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="aid-theme-teal min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1500px] items-center justify-between gap-3 px-4 py-2 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/batch" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--bg-hover)]" aria-label="返回普通批量任务"><ArrowLeft size={18} /></Link>
            <img src="/logo.png" alt="AID" className="h-8" />
            <div><h1 className="text-sm font-semibold text-white md:text-base">Story 全自动批量生产</h1><p className="hidden font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] sm:block">Excel → Story → Fish voice → storyboard → H3 → merge</p></div>
          </div>
          <button onClick={() => setShowSettings(true)} className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:bg-[var(--bg-hover)]"><Settings size={15} /> API 与 ComfyUI 设置</button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
        <section className="aid-page-lead">
          <div><p className="aid-eyebrow">Unattended story queue</p><h1 className="mt-2 text-2xl font-semibold text-white md:text-3xl">从基础故事自动生产整条成片</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">Fish ID 可以留空，系统会按角色资料自动选声并锁定。浏览器保持打开后，队列会依次完成剧本、分镜、参考图、视频片段和本地合并。</p></div>
          <div className="flex flex-wrap gap-2"><span className="rounded-full border border-[var(--border-color)] px-3 py-1.5 font-mono text-[10px]">NO PREVIEW</span><span className="rounded-full border border-[var(--border-color)] px-3 py-1.5 font-mono text-[10px]">FISH AUTO CAST</span><span className="rounded-full border border-[var(--border-color)] px-3 py-1.5 font-mono text-[10px]">LOCAL OUTPUT</span></div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 md:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div><div className="mb-2 flex items-center gap-2 text-[var(--accent-green)]"><FolderOpen size={20} /><h2 className="font-semibold text-white">Story 批量项目文件夹</h2></div><p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">文件夹根目录放 Excel；角色和物件参考图可放在任意子目录，并在表格中填写相对路径。成片、项目档案和日志会自动写回。</p></div>
              <div className="flex flex-wrap gap-2">
                <a href="/templates/AID-Story-批量生产模板.xlsx" download className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 text-xs hover:bg-[var(--bg-hover)]"><FileSpreadsheet size={15} /> 下载模板</a>
                <button onClick={openProjectFolder} disabled={isLoading || isRunning} className="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-3 text-xs font-medium text-white disabled:opacity-50">{isLoading ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}{projectHandle ? '重新选择' : '选择文件夹'}</button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-[var(--border-color)] pt-4 sm:grid-cols-3">
              <div><p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">项目文件夹</p><p className="mt-1 truncate text-sm">{projectName || '未连接'}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Excel</p><p className="mt-1 truncate text-sm">{workbookName || '—'}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">输出目录</p><p className="mt-1 truncate font-mono text-sm">{projectName ? `${projectName}/story-output` : '—'}</p></div>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between"><div><p className="aid-eyebrow">Live queue</p><h2 className="mt-1 text-sm font-semibold text-white">队列监控</h2></div><span className="font-mono text-2xl">{progress}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"><div className="h-full bg-[var(--accent-green)] transition-all" style={{ width: `${progress}%` }} /></div>
            <div className="mt-4 grid grid-cols-5 gap-2 text-center">{[['总计', stats.total], ['完成', stats.completed], ['运行', stats.active], ['等待', stats.waiting], ['异常', stats.failed]].map(([label, value]) => <div key={String(label)} className="rounded bg-[var(--bg-tertiary)] px-1 py-2"><p className="font-mono text-base">{value}</p><p className="text-[10px] text-[var(--text-secondary)]">{label}</p></div>)}</div>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-2 text-sm">{stats.failed ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[var(--warning)]" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--accent-green)]" />}<span className="break-words text-[var(--text-secondary)]">{message}</span></div>
          <div className="flex flex-col gap-2 sm:flex-row">{isRunning && <button onClick={() => { pauseAfterCurrentRef.current = true; setMessage('将在当前 Story 成片保存后暂停'); }} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--warning)]/50 px-4 text-xs text-[var(--warning)]"><Pause size={15} /> 完成当前项目后暂停</button>}<button onClick={runQueue} disabled={!projectHandle || isRunning || !tasks.length} className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent-green)] px-5 text-xs font-semibold text-[#10221e] disabled:opacity-40">{isRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{isRunning ? '全自动生产中' : '开始 / 继续 Story 批量生产'}</button></div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3"><h2 className="font-mono text-sm text-[var(--accent-green)]">Story 项目明细</h2><span className="hidden text-xs text-[var(--text-secondary)] sm:inline">严格按 Excel 行号顺序执行</span></div>
          {!tasks.length ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><FileSpreadsheet size={38} className="mx-auto mb-3 text-[var(--text-secondary)]" /><p className="text-sm">选择项目文件夹后，Story 队列显示在这里</p></div></div> : <div className="divide-y divide-[var(--border-color)]">{tasks.map(task => (
            <article key={task.id} className="grid gap-4 p-4 hover:bg-[var(--bg-hover)] lg:grid-cols-[72px_150px_minmax(280px,1fr)_190px_160px] lg:items-center">
              <div><p className="font-mono text-lg">#{task.sequence}</p><p className="text-[10px] text-[var(--text-secondary)]">Excel 第 {task.rowNumber} 行</p></div>
              <div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${statusColor(task.status)}`}>{task.status === 'completed' ? <CheckCircle2 size={13} /> : task.status === 'failed' || task.status === 'invalid' ? <XCircle size={13} /> : ACTIVE_STATUSES.has(task.status) ? <Loader2 size={13} className="animate-spin" /> : <Clock3 size={13} />}{STATUS_LABELS[task.status]}</span><p className="mt-2 truncate text-xs text-[var(--text-secondary)]" title={task.stage}>{task.stage || task.projectKey}</p></div>
              <div className="min-w-0"><p className="text-sm font-medium text-white">{task.projectName}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{task.storyContent}</p><div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-[var(--text-secondary)]"><span>{task.targetShotCount} 镜头</span><span>{task.aspectRatio}</span><span>{task.characters.length} 角色</span><span>{task.characters.filter(character => character.voiceId).length} 指定音色</span><span>{task.characters.filter(character => !character.voiceId).length} 自动选声</span></div>{task.error && <p className="mt-2 break-words text-xs text-[var(--error)]">{task.error}</p>}</div>
              <div className="text-xs"><p className="truncate font-mono" title={task.outputName}>{task.outputName}</p><p className="mt-2 text-[var(--text-secondary)]">耗时 {elapsedLabel(task, now)}</p><p className="mt-1 text-[var(--text-secondary)]">尝试 {task.attempts} / {task.maxRetries + 1}</p></div>
              <div className="flex flex-wrap justify-start gap-2 lg:justify-end">{task.status === 'completed' && <button onClick={() => downloadOutputCopy(task)} className="flex items-center gap-1.5 rounded border border-[var(--accent-blue)]/50 px-3 py-2 text-xs text-[var(--accent-blue)]"><Download size={14} /> 下载副本</button>}{(task.status === 'failed' || task.status === 'completed') && <button onClick={() => runSingle(task.id)} disabled={isRunning} className="flex items-center gap-1.5 rounded border border-[var(--border-color)] px-3 py-2 text-xs disabled:opacity-40"><RefreshCw size={14} /> {task.status === 'failed' ? '重试' : '重新生产'}</button>}{task.status === 'pending' && <button onClick={() => runSingle(task.id)} disabled={isRunning} className="flex items-center gap-1.5 rounded border border-[var(--border-color)] px-3 py-2 text-xs disabled:opacity-40"><Play size={14} /> 仅运行此项目</button>}</div>
            </article>
          ))}</div>}
        </section>

        <p className="pb-4 text-center text-xs text-[var(--text-secondary)]">请保持本页面打开。进度写入 story-batch-status.json，成片和项目断点写入 story-output。</p>
      </main>

      {runnerUrl && <iframe ref={runnerRef} key={runnerUrl} src={runnerUrl} title="AID Story batch runner" className="fixed left-0 top-0 h-px w-px border-0 opacity-0 pointer-events-none" aria-hidden="true" />}
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} settings={settings} onSave={saveSettings} />
    </div>
  );
}
