const GENERATED_IMAGE_HOSTS = new Set(['getapib.org', 'res.cloudinary.com']);
export function isStoredStoryboardSource(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && GENERATED_IMAGE_HOSTS.has(url.hostname);
  } catch { return false; }
}
export function storyboardImageFetchUrl(source: string): string {
  // The generated APIMart CDN allows display but not canvas/fetch CORS.
  // Cloudinary normally supports CORS and can retain its direct cache path.
  return isStoredStoryboardSource(source) && new URL(source).hostname === 'getapib.org'
    ? `/api/storyboard-image?url=${encodeURIComponent(source)}` : source;
}
export async function downloadStoryboardImage(source: string, request: typeof fetch = fetch): Promise<{ bytes: Buffer; contentType: string }> {
  if (!isStoredStoryboardSource(source)) throw new Error('仅允许读取已生成分镜的素材域名');
  const response = await request(source, { redirect: 'error', signal: AbortSignal.timeout(45_000), headers: { Accept: 'image/*' } });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !response.body || !/^image\/(?:png|jpeg|webp|avif)(?:;|$)/i.test(contentType)) throw new Error(`分镜素材读取失败（${response.status}）`);
  const limit = 25 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('分镜素材超过25MB'); }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response.body as any) {
    size += chunk.length;
    if (size > limit) throw new Error('分镜素材超过25MB');
    chunks.push(Buffer.from(chunk));
  }
  if (!size) throw new Error('分镜素材内容为空');
  return { bytes: Buffer.concat(chunks), contentType };
}
