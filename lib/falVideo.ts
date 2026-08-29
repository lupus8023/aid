export const FAL_H3_MAX_ENDPOINT = 'minimax/h3-max/image-to-video';
// fal queue submission uses the complete endpoint variant, but the official
// @fal-ai/client resolves status/result requests against the parent app id
// (owner + alias only). Keeping `/image-to-video` in those URLs returns 405.
export const FAL_H3_MAX_QUEUE_APP = 'minimax/h3-max';
const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';

export type FalH3MaxResolution = '480P' | '768P';
export type FalPromptExpansionMode = 'disabled' | 'balanced' | 'quality';

type FalQueueStatus = {
  status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  request_id?: string;
  queue_position?: number;
};

type FalVideoResult = {
  video?: { url?: string; content_type?: string; file_name?: string; file_size?: number };
  expanded_prompt?: string | null;
  timings?: Record<string, number> | null;
};

function credentials(apiKey?: string): string {
  const key = String(apiKey || process.env.FAL_KEY || '').trim().replace(/^Key\s+/i, '');
  if (!key) throw new Error('未配置 fal API Key');
  return `Key ${key}`;
}

async function falJson<T>(url: string, apiKey: string | undefined, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: credentials(apiKey),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    signal: init?.signal || AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!response.ok) {
    const detail = data?.detail || data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`fal H3 Max 请求失败：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return data as T;
}

export function falTaskId(requestId: string): string {
  return `fal:${requestId}`;
}

export function isFalVideoTask(taskId?: string): boolean {
  return typeof taskId === 'string' && taskId.startsWith('fal:') && taskId.length > 4;
}

export function falRequestId(taskId: string): string {
  if (!isFalVideoTask(taskId)) throw new Error('无效的 fal 视频任务 ID');
  return taskId.slice(4);
}

export async function createFalH3MaxVideoTask(input: {
  prompt: string;
  imageUrl?: string;
  endImageUrl?: string;
  duration?: number;
  resolution?: FalH3MaxResolution;
  promptExpansionMode?: FalPromptExpansionMode;
  seed?: number;
  apiKey?: string;
}): Promise<{ taskId: string; requestId: string }> {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('fal H3 Max 需要视频提示词');
  const duration = Math.min(15, Math.max(5, Math.ceil(Number(input.duration) || 5)));
  const payload = {
    prompt,
    duration,
    resolution: input.resolution === '480P' ? '480P' : '768P',
    prompt_expansion_mode: input.promptExpansionMode === 'balanced' || input.promptExpansionMode === 'quality'
      ? input.promptExpansionMode
      : 'disabled',
    enable_safety_checker: true,
    sync_mode: false,
    ...(Number.isInteger(input.seed) ? { seed: input.seed } : {}),
    ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
    ...(input.endImageUrl ? { end_image_url: input.endImageUrl } : {}),
  };
  const result = await falJson<FalQueueStatus>(
    `${FAL_QUEUE_BASE_URL}/${FAL_H3_MAX_ENDPOINT}`,
    input.apiKey,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  const requestId = String(result.request_id || '').trim();
  if (!requestId) throw new Error('fal H3 Max 没有返回 request_id');
  return { taskId: falTaskId(requestId), requestId };
}

export async function getFalH3MaxVideoStatus(
  taskId: string,
  apiKey?: string,
): Promise<{
  status: 'pending' | 'processing' | 'completed';
  videoUrl?: string;
  expandedPrompt?: string;
  queuePosition?: number;
  timings?: Record<string, number>;
}> {
  const requestId = falRequestId(taskId);
  const base = `${FAL_QUEUE_BASE_URL}/${FAL_H3_MAX_QUEUE_APP}/requests/${encodeURIComponent(requestId)}`;
  const queue = await falJson<FalQueueStatus>(`${base}/status?logs=0`, apiKey);
  if (queue.status === 'IN_QUEUE') {
    return { status: 'pending', queuePosition: queue.queue_position };
  }
  if (queue.status !== 'COMPLETED') return { status: 'processing' };
  const result = await falJson<FalVideoResult>(base, apiKey);
  const videoUrl = String(result.video?.url || '').trim();
  if (!videoUrl) throw new Error('fal H3 Max 任务完成但没有返回视频 URL');
  return {
    status: 'completed',
    videoUrl,
    ...(result.expanded_prompt ? { expandedPrompt: result.expanded_prompt } : {}),
    ...(result.timings ? { timings: result.timings } : {}),
  };
}
