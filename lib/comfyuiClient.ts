import type { AppSettings } from '@/types';

export const DEFAULT_COMFYUI_COMPANION_URL = 'http://127.0.0.1:3018';
export const STORY_COMPANION_MIN_VERSION = [0, 1, 15] as const;
export const SEGMENT_VIDEO_COMPANION_MIN_VERSION = [0, 1, 16] as const;

type ComfyUISettings = NonNullable<AppSettings['comfyui']>;

export function comfyUIApiUrl(pathname: string, settings?: Partial<ComfyUISettings>): string {
  if (settings?.useLocalCompanion === false) return pathname;
  const baseUrl = String(settings?.localCompanionUrl || DEFAULT_COMFYUI_COMPANION_URL).replace(/\/+$/, '');
  return `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

export function companionVersionAtLeast(version: string, minimum: readonly number[]): boolean {
  if (version === 'development') return true;
  const parts = version.split('.').map(value => Number(value) || 0);
  for (let index = 0; index < minimum.length; index += 1) {
    const required = minimum[index];
    const actual = parts[index] || 0;
    if (actual > required) return true;
    if (actual < required) return false;
  }
  return true;
}

function supportsStoryGeneration(version: string): boolean {
  return companionVersionAtLeast(version, STORY_COMPANION_MIN_VERSION);
}

/**
 * Long screenplay calls exceed Netlify's non-configurable 60-second function
 * limit. Prefer the local Companion when it supports Story routes, while
 * retaining the hosted endpoint for users without Companion.
 */
export async function fetchStoryApi(
  pathname: string,
  init: RequestInit,
  settings?: Partial<ComfyUISettings>,
): Promise<Response> {
  if (settings?.useLocalCompanion !== false) {
    try {
      const statusResponse = await fetch(comfyUIApiUrl('/api/companion/status', settings), {
        cache: 'no-store',
        signal: AbortSignal.timeout(1800),
      });
      const status = statusResponse.ok ? await statusResponse.json() : undefined;
      if (status?.ok && supportsStoryGeneration(String(status.version || ''))) {
        try {
          return await fetch(comfyUIApiUrl(pathname, settings), init);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Local Companion Story request failed: ${message}`);
          return new Response(JSON.stringify({
            error: `本地 Companion 剧本接口连接中断：${message}。请确认 Companion v0.1.15 正在运行后重试。`,
          }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    } catch {
      // Companion is optional; hosted API remains available for short jobs.
    }
  }
  return await fetch(pathname, init);
}

export function localComfyUISettings(settings?: Partial<ComfyUISettings>): Partial<ComfyUISettings> {
  return {
    ...settings,
    sshKeyPath: settings?.sshKeyPath || '~/.ssh/id_ed25519',
  };
}

export function isComfyUIClientTask(taskId: string): boolean {
  return /^comfyui(?:-long)?:/.test(String(taskId || ''));
}

async function responseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return String(data?.error || `请求失败（${response.status}）`);
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function downloadComfyUIVideo(
  taskId: string,
  settings?: Partial<ComfyUISettings>,
): Promise<string> {
  const response = await fetch(comfyUIApiUrl('/api/comfyui/download', settings), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, comfyui: localComfyUISettings(settings) }),
  });

  if (!response.ok) throw new Error(await responseError(response));

  const blob = await response.blob();
  if (!blob.size) throw new Error('ComfyUI 返回的视频文件为空');
  return URL.createObjectURL(blob);
}

export async function videoStatusResponseError(response: Response): Promise<string> {
  return responseError(response);
}
