import { uploadBufferToCloudinary, uploadToCloudinary } from './cloudinaryUpload';

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_STORED_IMAGE_BYTES = 9.5 * 1024 * 1024;

export async function fitImageUpload(buffer: Buffer): Promise<Buffer> {
  if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error('图片超过 50 MB，已保留生成任务，请手动处理原图');
  if (buffer.byteLength <= MAX_STORED_IMAGE_BYTES) return buffer;
  // Native image tooling is only needed for oversized sources. Do not make
  // ordinary uploads (or JSON validation) depend on loading it at cold start.
  const { default: sharp } = await import('sharp');
  const input = sharp(buffer, { limitInputPixels: 40_000_000 });
  const metadata = await input.metadata();
  if ((metadata.pages || 1) > 1) throw new Error('动态图超过上传限制，不能自动转换为静态图');
  // Preserve full resolution, orientation and transparency. Try lossless first;
  // never crop, resize or ask the provider to generate the image again.
  const image = input.rotate();
  const lossless = await image.clone().webp({ lossless: true, effort: 4 }).toBuffer();
  if (lossless.byteLength <= MAX_STORED_IMAGE_BYTES) return lossless;
  for (const quality of [95, 90, 85]) {
    const encoded = await image.clone().webp({ quality, alphaQuality: 100, effort: 4 }).toBuffer();
    if (encoded.byteLength <= MAX_STORED_IMAGE_BYTES) return encoded;
  }
  throw new Error('图片保留原尺寸压缩后仍超过上传限制；已保留生成任务，未重新生成');
}

async function downloadImage(source: string): Promise<Buffer> {
  const data = source.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/);
  if (data) {
    if (data[1].length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) throw new Error('图片超过 50 MB');
    return Buffer.from(data[1], 'base64');
  }
  const url = new URL(source);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('大图恢复需要 HTTPS 图片地址或图片数据');
  const response = await fetch(url, {
    headers: { Accept: 'image/*', Referer: 'https://apimart.ai/' },
    signal: AbortSignal.timeout(45_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`已生成图片下载失败（${response.status}），保留任务编号供重试`);
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new Error('图片超过 50 MB 或内容为空');
  }
  const reader = response.body.getReader(), chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error('图片超过 50 MB'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

function needsLocalProviderRelay(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.hostname === 'getapib.org'
      && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export async function uploadImage(source: string) {
  const options = { folder: 'aid-images', resource_type: 'image' as const };
  // Cloudinary fetching getapib.org by URL can remain pending until the local
  // worker's request timeout even though the paid image is already complete.
  // Relay that exact trusted host through Companion and upload the bytes; this
  // is storage-only recovery and never submits another generation request.
  if (needsLocalProviderRelay(source)) {
    return uploadBufferToCloudinary(await fitImageUpload(await downloadImage(source)), options);
  }
  try {
    return await uploadToCloudinary(source, options);
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
    // Network/account errors must not trigger a download or format conversion.
    if (!/file size too large/i.test(message)) throw error;
    return uploadBufferToCloudinary(await fitImageUpload(await downloadImage(source)), options);
  }
}

/** Browser-selected files should reach Companion as raw multipart bytes. This
 * avoids a 33% base64 expansion and large JSON request that Chromium may abort
 * before Next.js can return a useful error. */
export async function uploadImageBuffer(buffer: Buffer) {
  return uploadBufferToCloudinary(await fitImageUpload(buffer), {
    folder: 'aid-images',
    resource_type: 'image' as const,
  });
}
