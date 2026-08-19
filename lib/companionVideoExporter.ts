'use client';

import type { VideoClip } from '@/components/video-editor/types';
import type { AppSettings } from '@/types';
import {
  comfyUIApiUrl,
  companionVersionAtLeast,
  LOCAL_EXPORT_COMPANION_MIN_VERSION,
} from '@/lib/comfyuiClient';

type ComfyUISettings = NonNullable<AppSettings['comfyui']>;
type ProgressCallback = (progress: number, stage?: string) => void;

type ExportJobResponse = {
  job: {
    jobId: string;
    status: 'queued' | 'running' | 'retrying' | 'completed' | 'failed';
    progress: number;
    stage: string;
    error?: string;
  };
};

export type CompanionExportResult = {
  downloadUrl: string;
  fileName: string;
  jobId: string;
  blob: Blob;
};

const REQUEST_ATTEMPTS = 3;
const EXPORT_POLL_TIMEOUT_MS = 90 * 60 * 1000;

function pendingKey(projectId: string): string {
  return `aid:pending-native-export:${projectId}`;
}

export function hasPendingNativeExport(projectId: string): boolean {
  try {
    return localStorage.getItem(pendingKey(projectId)) !== null;
  } catch {
    return false;
  }
}

function markPending(projectId: string, jobId = ''): void {
  try {
    localStorage.setItem(pendingKey(projectId), JSON.stringify({ jobId, updatedAt: Date.now() }));
  } catch {}
}

function clearPending(projectId: string): void {
  try {
    localStorage.removeItem(pendingKey(projectId));
  } catch {}
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function responseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return String(data?.error || `请求失败（${response.status}）`);
  } catch {
    return `请求失败（${response.status}）`;
  }
}

async function retry<T>(label: string, operation: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < REQUEST_ATTEMPTS) await delay(attempt * 800);
    }
  }
  throw new Error(`${label}连续重试 ${REQUEST_ATTEMPTS} 次仍失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchClip(clip: VideoClip, index: number): Promise<Blob> {
  return retry(`读取片段 ${index + 1}`, async () => {
    const response = await fetch(clip.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('片段为空');
    return blob;
  });
}

async function requireNativeCompanion(settings?: Partial<ComfyUISettings>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(comfyUIApiUrl('/api/companion/status', settings), {
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    });
  } catch {
    throw new Error('无法连接本机 AID Companion。请确认 Companion 已启动后重试。');
  }
  if (!response.ok) throw new Error(await responseError(response));
  const status = await response.json();
  if (!status?.ok) throw new Error('本机 AID Companion 尚未就绪');
  if (!companionVersionAtLeast(String(status.version || ''), LOCAL_EXPORT_COMPANION_MIN_VERSION) || !status.nativeVideoExport) {
    throw new Error(`本机合并需要 AID Companion v${LOCAL_EXPORT_COMPANION_MIN_VERSION.join('.')} 或更高版本，请先更新 Companion。`);
  }
}

async function pollJob(
  projectId: string,
  jobId: string,
  settings: Partial<ComfyUISettings> | undefined,
  onProgress: ProgressCallback,
): Promise<ExportJobResponse['job']> {
  const startedAt = Date.now();
  let transientFailures = 0;
  while (Date.now() - startedAt < EXPORT_POLL_TIMEOUT_MS) {
    try {
      const url = comfyUIApiUrl(
        `/api/companion/export/status?projectId=${encodeURIComponent(projectId)}&jobId=${encodeURIComponent(jobId)}`,
        settings,
      );
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as ExportJobResponse;
      transientFailures = 0;
      const job = data.job;
      onProgress(Math.min(99, 48 + Number(job.progress || 0) * 0.51), job.stage || '本机合并中');
      if (job.status === 'completed') return job;
      if (job.status === 'failed') throw new Error(job.error || '本机 FFmpeg 合并失败');
    } catch (error) {
      transientFailures += 1;
      if (transientFailures >= REQUEST_ATTEMPTS) throw error;
    }
    await delay(1200);
  }
  throw new Error('本机合并超过 90 分钟，任务记录仍保留，可刷新后自动继续');
}

export async function exportVideoWithCompanion(
  clips: VideoClip[],
  options: {
    projectId: string;
    projectName?: string;
    settings?: Partial<ComfyUISettings>;
    onProgress: ProgressCallback;
  },
): Promise<CompanionExportResult> {
  const { projectId, settings, onProgress } = options;
  if (!projectId) throw new Error('缺少项目标识，无法安全恢复导出');
  markPending(projectId);
  onProgress(2, '连接本机 Companion');
  await requireNativeCompanion(settings);

  const uploaded: Array<VideoClip & { segmentSha256: string }> = [];
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    onProgress(5 + (index / clips.length) * 38, `保存片段 ${index + 1}/${clips.length}`);
    const blob = await fetchClip(clip, index);
    const segmentSha256 = await sha256(blob);
    const uploadUrl = comfyUIApiUrl(
      `/api/companion/export/segment?projectId=${encodeURIComponent(projectId)}&clipId=${encodeURIComponent(clip.id)}&sha256=${segmentSha256}`,
      settings,
    );
    await retry(`保存片段 ${index + 1}`, async () => {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'video/mp4' },
        body: blob,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json();
      if (!result?.ok || result.sha256 !== segmentSha256) throw new Error('Companion 片段校验失败');
    });
    uploaded.push({ ...clip, segmentSha256 });
  }

  onProgress(45, '全部片段已落地，创建合并任务');
  const outputName = `${String(options.projectName || 'AID-Story').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)}.mp4`;
  const mergeResponse = await retry('创建本机合并任务', async () => {
    const response = await fetch(comfyUIApiUrl('/api/companion/export/merge', settings), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        outputName,
        clips: uploaded.map(clip => ({
          clipId: clip.id,
          name: clip.name,
          duration: clip.duration,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd,
          segmentSha256: clip.segmentSha256,
        })),
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return await response.json() as ExportJobResponse;
  });
  const jobId = mergeResponse.job.jobId;
  markPending(projectId, jobId);
  const job = mergeResponse.job.status === 'completed'
    ? mergeResponse.job
    : await pollJob(projectId, jobId, settings, onProgress);
  if (job.status !== 'completed') throw new Error(job.error || '本机合并未完成');

  const downloadUrl = comfyUIApiUrl(
    `/api/companion/export/download?projectId=${encodeURIComponent(projectId)}&jobId=${encodeURIComponent(jobId)}`,
    settings,
  );
  onProgress(99, '读取本机成片');
  const blob = await retry('读取本机成片', async () => {
    const response = await fetch(downloadUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.blob();
    if (!result.size) throw new Error('本机成片为空');
    return result;
  });
  clearPending(projectId);
  onProgress(100, '完成；本机片段与成片均已保留');
  return {
    jobId,
    fileName: outputName,
    downloadUrl,
    blob,
  };
}
