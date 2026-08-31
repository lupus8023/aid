import { readApiJson } from './apiResponse';

function needsPersistence(source: string): boolean {
  if (source.startsWith('data:image/')) return true;
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.hostname === 'getapib.org'
      && !url.username && !url.password && !url.port;
  } catch { return false; }
}

/** Store paid APIMart output before marking the storyboard complete. */
export async function persistGeneratedStoryboardImage(source: string, request: typeof fetch = fetch): Promise<string> {
  if (!needsPersistence(source)) return source;
  const response = await request('/api/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData: source }),
  });
  const result = await readApiJson<{ url?: string }>(response, '保存已生成分镜失败，已保留生成任务');
  if (typeof result.url !== 'string' || !result.url.startsWith('https://') || result.url === source) {
    throw new Error('保存已生成分镜后没有返回素材地址；已保留生成任务');
  }
  return result.url;
}
