import type { AppSettings } from '@/types';

export const DEFAULT_COMFYUI_COMPANION_URL = 'http://127.0.0.1:3018';

type ComfyUISettings = NonNullable<AppSettings['comfyui']>;

export function comfyUIApiUrl(pathname: string, settings?: Partial<ComfyUISettings>): string {
  if (settings?.useLocalCompanion === false) return pathname;
  const baseUrl = String(settings?.localCompanionUrl || DEFAULT_COMFYUI_COMPANION_URL).replace(/\/+$/, '');
  return `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
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
