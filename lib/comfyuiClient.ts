import type { AppSettings } from '@/types';
import { isComfyUIZImageTurbo } from './imageModels';

export const DEFAULT_COMFYUI_COMPANION_URL = 'http://127.0.0.1:3018';
// Story generation runs inside the packaged Companion so long 27–81 shot jobs
// are not cut off by the hosting gateway. Keep this gate aligned with the
// screenplay schema: older builds silently drop newer narrative fields.
export const STORY_COMPANION_MIN_VERSION = [0, 1, 86] as const;
export const SEGMENT_VIDEO_COMPANION_MIN_VERSION = [0, 1, 85] as const;
export const LOCAL_EXPORT_COMPANION_MIN_VERSION = [0, 1, 19] as const;

type ComfyUISettings = NonNullable<AppSettings['comfyui']>;

export function comfyUIApiUrl(pathname: string, settings?: Partial<ComfyUISettings>): string {
  if (settings?.useLocalCompanion === false) return pathname;
  const baseUrl = String(settings?.localCompanionUrl || DEFAULT_COMFYUI_COMPANION_URL).replace(/\/+$/, '');
  return `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

export function imageApiUrl(
  pathname: string,
  settings: Partial<ComfyUISettings> | undefined,
  modelOrTaskId: string,
): string {
  return isComfyUIZImageTurbo(modelOrTaskId) || String(modelOrTaskId || '').startsWith('comfyui-image:')
    ? comfyUIApiUrl(pathname, settings)
    : pathname;
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
 * retaining the hosted endpoint only when users explicitly disable Companion.
 */
export async function fetchStoryApi(
  pathname: string,
  init: RequestInit,
  settings?: Partial<ComfyUISettings>,
): Promise<Response> {
  if (settings?.useLocalCompanion !== false) {
    let status: any;
    let statusError = '';
    for (let attempt = 1; attempt <= 2 && !status?.ok; attempt += 1) {
      try {
        const statusResponse = await fetch(comfyUIApiUrl('/api/companion/status', settings), {
          cache: 'no-store',
          signal: AbortSignal.timeout(3500),
        });
        if (!statusResponse.ok) throw new Error(`HTTP ${statusResponse.status}`);
        status = await statusResponse.json();
        if (!status?.ok) throw new Error('状态响应缺少 ok=true');
      } catch (error) {
        statusError = error instanceof Error ? error.message : String(error);
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350));
      }
    }
    if (!status?.ok) {
      // Never silently reroute a multi-stage screenplay to Netlify: the hosted
      // function has a hard ceiling and eventually replaces the useful error
      // with an HTML 504 page. Users who explicitly disable Companion may still
      // choose the hosted route for small diagnostic jobs.
      return new Response(JSON.stringify({
        error: `网页无法访问本地 Companion（${statusError || '连接失败'}）。请确认 AID Companion 正在运行，并在浏览器的网站权限中允许 pandais.beauty 访问“本地网络”，然后刷新页面重试。`,
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!supportsStoryGeneration(String(status.version || ''))) {
      return new Response(JSON.stringify({
        error: `当前 Companion v${status.version || '未知'} 不支持分阶段剧本生成；请更新到 v${STORY_COMPANION_MIN_VERSION.join('.')} 或更高版本。`,
      }), {
        status: 426,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      return await fetch(comfyUIApiUrl(pathname, settings), init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Local Companion Story request failed: ${message}`);
      return new Response(JSON.stringify({
        error: `本地 Companion 剧本接口连接中断：${message}。请保持 Companion v${STORY_COMPANION_MIN_VERSION.join('.')} 或更高版本运行，并允许浏览器访问本地网络后重试。`,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
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
  options?: { smoothAudioTail?: boolean },
): Promise<string> {
  const response = await fetch(comfyUIApiUrl('/api/comfyui/download', settings), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId,
      comfyui: localComfyUISettings(settings),
      smoothAudioTail: options?.smoothAudioTail === true,
    }),
  });

  if (!response.ok) throw new Error(await responseError(response));

  const blob = await response.blob();
  if (!blob.size) throw new Error('ComfyUI 返回的视频文件为空');
  return URL.createObjectURL(blob);
}

export async function videoStatusResponseError(response: Response): Promise<string> {
  return responseError(response);
}
