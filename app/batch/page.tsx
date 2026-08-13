'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
import {
  BatchTaskStatus,
  MiniMaxBatchTask,
  parseMiniMaxBatchWorkbook,
  workflowLabel,
} from '@/lib/minimaxBatch';

const STATUS_LABELS: Record<BatchTaskStatus, string> = {
  pending: '等待中',
  invalid: '需要修正',
  submitting: '正在上传',
  generating: '生成中',
  downloading: '写入文件',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const ACTIVE_STATUSES = new Set<BatchTaskStatus>(['submitting', 'generating', 'downloading']);

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function getFileHandleAtPath(root: FileSystemDirectoryHandle, relativePath: string): Promise<FileSystemFileHandle> {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) throw new Error(`无效素材路径：${relativePath}`);
  let directory = root;
  for (const segment of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
  return await directory.getFileHandle(parts[parts.length - 1]);
}

async function readProjectFile(root: FileSystemDirectoryHandle, relativePath: string): Promise<File> {
  return await (await getFileHandleAtPath(root, relativePath)).getFile();
}

async function writeProjectFile(root: FileSystemDirectoryHandle, relativePath: string, data: Blob | string): Promise<void> {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) throw new Error(`无效输出路径：${relativePath}`);
  let directory = root;
  for (const segment of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(segment, { create: true });
  const handle = await directory.getFileHandle(parts[parts.length - 1], { create: true });
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
    if (handle.kind === 'file' && /\.xlsx$/i.test(name) && !name.startsWith('~$')) {
      candidates.push(handle as FileSystemFileHandle);
    }
  }
  if (!candidates.length) throw new Error('项目文件夹根目录中没有找到 .xlsx 任务表');
  return candidates.sort((a, b) => {
    const score = (name: string) => /^(jobs|minimax|批量任务)/i.test(name) ? 0 : 1;
    return score(a.name) - score(b.name) || a.name.localeCompare(b.name);
  })[0];
}

function elapsedLabel(task: MiniMaxBatchTask, now: number): string {
  if (!task.startedAt) return '—';
  const end = task.finishedAt || now;
  const seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}分${seconds % 60}秒` : `${seconds}秒`;
}

function statusColor(status: BatchTaskStatus): string {
  if (status === 'completed') return 'text-[var(--success)] border-[var(--success)]/40 bg-[var(--success)]/5';
  if (status === 'failed' || status === 'invalid') return 'text-[var(--error)] border-[var(--error)]/40 bg-[var(--error)]/5';
  if (ACTIVE_STATUSES.has(status)) return 'text-[var(--accent-blue)] border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/5';
  return 'text-[var(--text-secondary)] border-[var(--border-color)] bg-[var(--bg-tertiary)]';
}

export default function MiniMaxBatchPage() {
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [projectHandle, setProjectHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const projectHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [projectName, setProjectName] = useState('');
  const [workbookName, setWorkbookName] = useState('');
  const workbookNameRef = useRef('');
  const [tasks, setTasks] = useState<MiniMaxBatchTask[]>([]);
  const tasksRef = useRef<MiniMaxBatchTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState('请选择包含 Excel 和素材的项目文件夹');
  const [now, setNow] = useState(Date.now());
  const pauseAfterCurrentRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const persistTasks = useCallback(async (nextTasks: MiniMaxBatchTask[]) => {
    const root = projectHandleRef.current;
    if (!root) return;
    const snapshot = {
      version: 1,
      workbook: workbookNameRef.current,
      updatedAt: new Date().toISOString(),
      tasks: nextTasks.map(task => ({
        id: task.id,
        rowNumber: task.rowNumber,
        sequence: task.sequence,
        workflow: task.workflow,
        status: task.status,
        taskId: task.taskId,
        outputName: task.outputName,
        attempts: task.attempts,
        error: task.error,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
      })),
    };
    const csvRows = [
      ['序号', 'Excel行', '工作流', '状态', 'Task ID', '输出文件', '尝试次数', '开始时间', '完成时间', '错误'],
      ...nextTasks.map(task => [
        task.sequence,
        task.rowNumber,
        workflowLabel(task.workflow),
        STATUS_LABELS[task.status],
        task.taskId || '',
        task.outputName,
        task.attempts,
        task.startedAt ? new Date(task.startedAt).toISOString() : '',
        task.finishedAt ? new Date(task.finishedAt).toISOString() : '',
        task.error || '',
      ]),
    ];
    await Promise.all([
      writeProjectFile(root, 'batch-status.json', JSON.stringify(snapshot, null, 2)),
      writeProjectFile(root, 'batch-log.csv', `\uFEFF${csvRows.map(row => row.map(csvCell).join(',')).join('\n')}`),
    ]);
  }, []);

  const schedulePersist = useCallback((nextTasks: MiniMaxBatchTask[]) => {
    persistQueueRef.current = persistQueueRef.current
      .catch(() => undefined)
      .then(() => persistTasks(nextTasks))
      .catch(error => console.error('保存批量进度失败:', error));
  }, [persistTasks]);

  const commitTasks = useCallback((updater: (current: MiniMaxBatchTask[]) => MiniMaxBatchTask[]) => {
    const next = updater(tasksRef.current);
    tasksRef.current = next;
    setTasks(next);
    schedulePersist(next);
    return next;
  }, [schedulePersist]);

  const updateTask = useCallback((id: string, patch: Partial<MiniMaxBatchTask>) => {
    return commitTasks(current => current.map(task => task.id === id ? { ...task, ...patch } : task));
  }, [commitTasks]);

  const validateAssets = useCallback(async (root: FileSystemDirectoryHandle, parsed: MiniMaxBatchTask[]) => {
    const checked: MiniMaxBatchTask[] = [];
    for (const task of parsed) {
      if (!task.enabled || task.status === 'invalid') {
        checked.push(task);
        continue;
      }
      try {
        const imagePaths = [task.mainImage, task.endFrame, ...task.referenceImages].filter(Boolean);
        for (const imagePath of imagePaths) {
          const file = await readProjectFile(root, imagePath);
          if (file.size > 6 * 1024 * 1024) throw new Error(`${imagePath} 超过 6MB`);
        }
        for (const audioPath of task.referenceAudios) {
          const file = await readProjectFile(root, audioPath);
          if (file.size > 20 * 1024 * 1024) throw new Error(`${audioPath} 超过 20MB`);
        }
        checked.push(task);
      } catch (error) {
        checked.push({
          ...task,
          status: 'invalid',
          error: error instanceof Error ? `素材检查失败：${error.message}` : '素材检查失败',
        });
      }
    }
    return checked;
  }, []);

  const restoreProgress = useCallback(async (root: FileSystemDirectoryHandle, parsed: MiniMaxBatchTask[]) => {
    try {
      const savedFile = await readProjectFile(root, 'batch-status.json');
      const saved = JSON.parse(await savedFile.text()) as { tasks?: Array<Partial<MiniMaxBatchTask> & { id: string }> };
      const byId = new Map((saved.tasks || []).map(task => [task.id, task]));
      return parsed.map(task => {
        const prior = byId.get(task.id);
        if (!prior || task.status === 'invalid' || task.status === 'skipped') return task;
        const restoredStatus: BatchTaskStatus = prior.status === 'completed'
          ? 'completed'
          : prior.taskId && !['failed', 'invalid'].includes(String(prior.status))
            ? 'generating'
            : prior.status === 'failed'
              ? 'failed'
              : 'pending';
        return {
          ...task,
          status: restoredStatus,
          taskId: prior.taskId,
          attempts: Number(prior.attempts) || 0,
          error: prior.error,
          startedAt: prior.startedAt,
          finishedAt: prior.finishedAt,
        };
      });
    } catch {
      return parsed;
    }
  }, []);

  const openProjectFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      setMessage('当前浏览器不支持直接读写文件夹，请使用桌面版 Chrome 或 Edge');
      return;
    }
    setIsLoading(true);
    try {
      const root = await window.showDirectoryPicker({ id: 'aid-minimax-batch', mode: 'readwrite' });
      const workbookHandle = await findWorkbook(root);
      const workbookFile = await workbookHandle.getFile();
      const parsed = await parseMiniMaxBatchWorkbook(await workbookFile.arrayBuffer());
      const validated = await validateAssets(root, parsed);
      const restored = await restoreProgress(root, validated);
      projectHandleRef.current = root;
      setProjectHandle(root);
      setProjectName(root.name);
      setWorkbookName(workbookHandle.name);
      workbookNameRef.current = workbookHandle.name;
      tasksRef.current = restored;
      setTasks(restored);
      const executable = restored.filter(task => task.status === 'pending' || task.status === 'generating').length;
      const invalid = restored.filter(task => task.status === 'invalid').length;
      setMessage(`已读取 ${restored.length} 条任务，可执行 ${executable} 条${invalid ? `，${invalid} 条需要修正` : ''}`);
      schedulePersist(restored);
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        setMessage(error instanceof Error ? error.message : '读取项目文件夹失败');
      }
    } finally {
      setIsLoading(false);
    }
  }, [restoreProgress, schedulePersist, validateAssets]);

  const submitTask = useCallback(async (task: MiniMaxBatchTask): Promise<string> => {
    const root = projectHandleRef.current;
    if (!root) throw new Error('项目文件夹连接已丢失，请重新选择文件夹');
    const mainImage = await fileToDataUrl(await readProjectFile(root, task.mainImage));
    const referenceImages = task.workflow === 'first_last'
      ? [await fileToDataUrl(await readProjectFile(root, task.endFrame))]
      : await Promise.all(task.referenceImages.map(async path => fileToDataUrl(await readProjectFile(root, path))));
    const audioFiles = await Promise.all(task.referenceAudios.map(async path => fileToDataUrl(await readProjectFile(root, path))));
    const response = await fetch(comfyUIApiUrl('/api/image-to-video', settings.comfyui), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mainImage,
        referenceImages,
        secondImageRole: task.workflow === 'first_last' ? 'last_frame' : task.workflow === 'multi_reference' ? 'reference' : undefined,
        comfyWorkflowMode: task.workflow,
        prompt: task.prompt,
        aspectRatio: task.aspectRatio,
        duration: task.duration,
        audioFiles,
        videoProvider: 'comfyui',
        comfyui: localComfyUISettings(settings.comfyui),
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json();
    if (!data.taskId) throw new Error('本地 Companion 没有返回 Task ID');
    return data.taskId;
  }, [settings.comfyui]);

  const waitForTask = useCallback(async (taskId: string): Promise<void> => {
    const timeoutSeconds = Math.max(300, Number(settings.comfyui?.timeoutSeconds) || 7200);
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 10000));
      const response = await fetch(comfyUIApiUrl('/api/check-video-status', settings.comfyui), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          localDelivery: true,
          comfyui: localComfyUISettings(settings.comfyui),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json();
      if (data.status === 'completed' && data.readyForDownload) return;
      if (data.status === 'failed') throw new Error(data.error || 'ComfyUI 任务执行失败');
    }
    throw new Error(`生成超时（${timeoutSeconds} 秒）`);
  }, [settings.comfyui]);

  const saveTaskOutput = useCallback(async (taskId: string, outputName: string): Promise<void> => {
    const root = projectHandleRef.current;
    if (!root) throw new Error('项目文件夹连接已丢失，请重新选择文件夹');
    const response = await fetch(comfyUIApiUrl('/api/comfyui/download', settings.comfyui), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, comfyui: localComfyUISettings(settings.comfyui) }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    await writeProjectFile(root, `output/${outputName}`, await response.blob());
  }, [settings.comfyui]);

  const executeTask = useCallback(async (id: string, reset = false) => {
    if (reset) updateTask(id, { status: 'pending', error: undefined, taskId: undefined, attempts: 0, startedAt: undefined, finishedAt: undefined });
    while (true) {
      let task = tasksRef.current.find(item => item.id === id);
      if (!task || task.status === 'invalid' || task.status === 'skipped' || task.status === 'completed') return;
      if (!task.taskId && task.attempts > task.maxRetries) return;
      try {
        if (!task.taskId) {
          const attempts = task.attempts + 1;
          updateTask(id, {
            status: 'submitting',
            error: undefined,
            attempts,
            startedAt: task.startedAt || Date.now(),
            finishedAt: undefined,
          });
          const taskId = await submitTask({ ...task, attempts });
          updateTask(id, { status: 'generating', taskId });
          task = { ...task, attempts, taskId };
        } else {
          updateTask(id, { status: 'generating', error: undefined, startedAt: task.startedAt || Date.now() });
        }
        const activeTaskId = task.taskId;
        if (!activeTaskId) throw new Error('任务提交后没有可监控的 Task ID');
        await waitForTask(activeTaskId);
        updateTask(id, { status: 'downloading' });
        await saveTaskOutput(activeTaskId, task.outputName);
        updateTask(id, { status: 'completed', error: undefined, finishedAt: Date.now() });
        return;
      } catch (error) {
        const latest = tasksRef.current.find(item => item.id === id);
        if (!latest) return;
        const errorMessage = error instanceof Error ? error.message : '任务执行失败';
        if (latest.attempts <= latest.maxRetries) {
          updateTask(id, { status: 'pending', taskId: undefined, error: `${errorMessage}；准备重试` });
          await new Promise(resolve => window.setTimeout(resolve, 2000));
          continue;
        }
        updateTask(id, { status: 'failed', error: errorMessage, finishedAt: Date.now() });
        return;
      }
    }
  }, [saveTaskOutput, submitTask, updateTask, waitForTask]);

  const verifyCompanion = useCallback(async () => {
    const response = await fetch(comfyUIApiUrl('/api/comfyui/test', settings.comfyui), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: localComfyUISettings(settings.comfyui) }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'ComfyUI 连接测试失败');
  }, [settings.comfyui]);

  const runQueue = useCallback(async () => {
    if (!projectHandle || isRunning) return;
    const runnable = tasksRef.current.filter(task => ['pending', 'failed', 'generating'].includes(task.status));
    if (!runnable.length) {
      setMessage('没有等待执行的任务');
      return;
    }
    setIsRunning(true);
    pauseAfterCurrentRef.current = false;
    setMessage('正在检查本地 Companion 和仙宫云连接…');
    try {
      await verifyCompanion();
      setMessage('批量生产已开始，将按 Excel 顺序逐条处理');
      for (const queued of tasksRef.current) {
        const current = tasksRef.current.find(task => task.id === queued.id);
        if (!current || !['pending', 'failed', 'generating'].includes(current.status)) continue;
        await executeTask(current.id, current.status === 'failed');
        if (pauseAfterCurrentRef.current) {
          setMessage('已在当前任务完成后暂停');
          break;
        }
      }
      if (!pauseAfterCurrentRef.current) setMessage('本轮批量任务处理完毕');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量生产启动失败');
    } finally {
      setIsRunning(false);
    }
  }, [executeTask, isRunning, projectHandle, verifyCompanion]);

  const runSingle = useCallback(async (id: string) => {
    if (isRunning) return;
    setIsRunning(true);
    pauseAfterCurrentRef.current = false;
    try {
      await verifyCompanion();
      const task = tasksRef.current.find(item => item.id === id);
      await executeTask(id, task?.status === 'failed' || task?.status === 'completed');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '任务启动失败');
    } finally {
      setIsRunning(false);
    }
  }, [executeTask, isRunning, verifyCompanion]);

  const downloadOutputCopy = useCallback(async (task: MiniMaxBatchTask) => {
    const root = projectHandleRef.current;
    if (!root) return;
    try {
      const file = await readProjectFile(root, `output/${task.outputName}`);
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = task.outputName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取本地成品失败');
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
    <div className="aid-theme-purple min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/95 shadow-[0_8px_32px_-24px_var(--shadow)] backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1500px] items-center justify-between gap-3 px-4 py-2 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]" aria-label="返回首页">
              <ArrowLeft size={18} />
            </Link>
            <img src="/logo.png" alt="AID" className="h-8" />
            <div>
              <h1 className="text-sm font-semibold text-white md:text-base">MiniMax H3 批量生产</h1>
              <p className="hidden font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] sm:block">Excel 驱动 · 自动工作流 · 本地逐条保存</p>
            </div>
          </div>
          <button onClick={() => setShowSettings(true)} className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
            <Settings size={15} /> ComfyUI 设置
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
        <section className="aid-page-lead">
          <div><p className="aid-eyebrow">Batch production console</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">把 Excel 任务变成连续生产队列</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">连接项目文件夹后自动检查素材与工作流，按 Excel 顺序生成、监控，并把结果逐条写回本地。</p></div>
          <div className="flex flex-wrap gap-2"><span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">MINIMAX H3</span><span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">LOCAL OUTPUT</span></div>
        </section>
        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 md:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[var(--accent-green)]">
                  <FolderOpen size={20} />
                  <h2 className="text-base font-semibold text-white">批量项目文件夹</h2>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                  选择包含 Excel 与 assets 的文件夹。AID 会读取任务、检查素材，并把视频逐条写入同一文件夹下的 output。
                </p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                <a href="/templates/MiniMax-H3-批量任务模板.xlsx" download className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-3 text-xs hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] sm:flex-none">
                  <FileSpreadsheet size={15} /> 下载模板
                </a>
                <button onClick={openProjectFolder} disabled={isLoading || isRunning} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--accent-blue)] px-3 text-xs font-medium text-white hover:bg-[var(--accent-blue-strong)] disabled:opacity-50 sm:flex-none">
                  {isLoading ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                  {projectHandle ? '重新选择' : '选择文件夹'}
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-[var(--border-color)] pt-4 sm:grid-cols-3">
              <div><p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">项目</p><p className="mt-1 truncate text-sm">{projectName || '未连接'}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">Excel</p><p className="mt-1 truncate text-sm">{workbookName || '—'}</p></div>
              <div><p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">输出目录</p><p className="mt-1 truncate font-mono text-sm">{projectName ? `${projectName}/output` : '—'}</p></div>
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div><p className="aid-eyebrow">Live queue</p><h2 className="mt-1 text-sm font-semibold text-white">队列监控</h2></div>
              <span className="font-mono text-2xl">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
              <div className="h-full bg-[var(--accent-green)] transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2 text-center">
              {[
                ['总计', stats.total], ['完成', stats.completed], ['运行', stats.active], ['等待', stats.waiting], ['异常', stats.failed],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded bg-[var(--bg-tertiary)] px-1 py-2">
                  <p className="font-mono text-base">{value}</p><p className="text-[10px] text-[var(--text-secondary)]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-2 text-sm">
            {stats.failed ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[var(--warning)]" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--accent-green)]" />}
            <span className="break-words text-[var(--text-secondary)]">{message}</span>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row lg:w-auto lg:shrink-0">
            {isRunning && (
              <button onClick={() => { pauseAfterCurrentRef.current = true; setMessage('将在当前任务完成并保存后暂停'); }} className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--warning)]/50 px-4 text-xs text-[var(--warning)] hover:bg-[var(--warning)]/10">
                <Pause size={15} /> 完成当前任务后暂停
              </button>
            )}
            <button onClick={runQueue} disabled={!projectHandle || isRunning || !tasks.length} className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent-green)] px-5 text-xs font-semibold text-[#10221e] hover:brightness-110 disabled:opacity-40">
              {isRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {isRunning ? '批量运行中' : '开始 / 继续批量生产'}
            </button>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
            <h2 className="font-mono text-sm text-[var(--accent-green)]">任务明细与监控</h2>
            <span className="hidden text-xs text-[var(--text-secondary)] sm:inline">严格按 Excel 行号顺序执行</span>
          </div>
          {!tasks.length ? (
            <div className="grid min-h-72 place-items-center p-8 text-center">
              <div><FileSpreadsheet size={38} className="mx-auto mb-3 text-[var(--text-secondary)]" /><p className="text-sm">选择项目文件夹后，任务会显示在这里</p></div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-color)]">
              {tasks.map(task => (
                <article key={task.id} className="grid gap-4 p-4 hover:bg-[var(--bg-hover)] lg:grid-cols-[72px_140px_minmax(260px,1fr)_170px_160px] lg:items-center">
                  <div>
                    <p className="font-mono text-lg">#{task.sequence}</p>
                    <p className="text-[10px] text-[var(--text-secondary)]">Excel 第 {task.rowNumber} 行</p>
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${statusColor(task.status)}`}>
                      {task.status === 'completed' ? <CheckCircle2 size={13} /> : task.status === 'failed' || task.status === 'invalid' ? <XCircle size={13} /> : ACTIVE_STATUSES.has(task.status) ? <Loader2 size={13} className="animate-spin" /> : <Clock3 size={13} />}
                      {STATUS_LABELS[task.status]}
                    </span>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">{workflowLabel(task.workflow)} · {task.workflowSource === 'auto' ? '自动识别' : 'Excel指定'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm leading-5">{task.prompt || '—'}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                      <span>{task.duration} 秒</span><span>{task.aspectRatio}</span><span>{1 + task.referenceImages.length + (task.endFrame ? 1 : 0)} 张图</span><span>{task.referenceAudios.length} 条音频</span>
                    </div>
                    {task.error && <p className="mt-2 break-words text-xs text-[var(--error)]">{task.error}</p>}
                  </div>
                  <div className="text-xs">
                    <p className="truncate font-mono" title={task.outputName}>{task.outputName}</p>
                    <p className="mt-2 text-[var(--text-secondary)]">耗时 {elapsedLabel(task, now)}</p>
                    <p className="mt-1 text-[var(--text-secondary)]">尝试 {task.attempts} / {task.maxRetries + 1}</p>
                    {task.taskId && <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-secondary)]" title={task.taskId}>{task.taskId}</p>}
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    {task.status === 'completed' && (
                      <button onClick={() => downloadOutputCopy(task)} className="flex items-center gap-1.5 rounded border border-[var(--accent-blue)]/50 px-3 py-2 text-xs text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10">
                        <Download size={14} /> 下载副本
                      </button>
                    )}
                    {(task.status === 'failed' || task.status === 'completed') && (
                      <button onClick={() => runSingle(task.id)} disabled={isRunning} className="flex items-center gap-1.5 rounded border border-[var(--border-color)] px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-40">
                        <RefreshCw size={14} /> {task.status === 'failed' ? '重试' : '重新生成'}
                      </button>
                    )}
                    {task.status === 'pending' && (
                      <button onClick={() => runSingle(task.id)} disabled={isRunning} className="flex items-center gap-1.5 rounded border border-[var(--border-color)] px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-40">
                        <Play size={14} /> 仅运行此条
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="pb-4 text-center text-xs text-[var(--text-secondary)]">
          任务进度同时保存为 batch-status.json 和 batch-log.csv；关闭页面后，重新选择同一文件夹即可继续。
        </p>
      </main>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} settings={settings} onSave={saveSettings} />
    </div>
  );
}
