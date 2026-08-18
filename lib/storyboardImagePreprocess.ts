const MAX_REFERENCE_BYTES = 1_600_000;

const TARGETS = {
  '16:9': { ratio: 16 / 9, maxWidth: 1600, maxHeight: 900 },
  '9:16': { ratio: 9 / 16, maxWidth: 900, maxHeight: 1600 },
  '1:1': { ratio: 1, maxWidth: 1440, maxHeight: 1440 },
} as const;

async function fetchSourceBlob(source: string, label: string): Promise<Blob> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(source, {
        cache: source.startsWith('http') ? 'force-cache' : 'default',
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      break;
    } catch (error) {
      response = undefined;
      lastError = error;
      if (attempt < 4) await new Promise(resolve => window.setTimeout(resolve, attempt * 700));
    }
  }
  if (!response) throw new Error(`${label}读取失败：${lastError instanceof Error ? lastError.message : '网络连接中断'}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error(`${label}内容为空`);
  return blob;
}

async function loadImage(blob: Blob, label: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(`${label}尺寸无效`);
    return image;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function blobDataUrl(blob: Blob, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`${label}转换失败`));
    reader.onerror = () => reject(new Error(`${label}转换失败`));
    reader.readAsDataURL(blob);
  });
}

/**
 * Turns a large grid crop or 4K still into a compact, H3-ready reference.
 * It crops once to the project ratio, keeps useful detail up to 1600 px and
 * applies a quality/size ladder instead of blindly lowering resolution.
 */
export async function prepareStoryboardReference(
  source: string,
  label: string,
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
): Promise<string> {
  if (typeof document === 'undefined') return source;
  const blob = await fetchSourceBlob(source, label);
  const image = await loadImage(blob, label);
  const objectUrl = image.src;
  try {
    const target = TARGETS[aspectRatio];
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    let sx = 0;
    let sy = 0;
    let sw = image.naturalWidth;
    let sh = image.naturalHeight;
    if (sourceRatio > target.ratio) {
      sw = Math.round(sh * target.ratio);
      sx = Math.round((image.naturalWidth - sw) / 2);
    } else if (sourceRatio < target.ratio) {
      sh = Math.round(sw / target.ratio);
      sy = Math.round((image.naturalHeight - sh) / 2);
    }

    const baseScale = Math.min(1, target.maxWidth / sw, target.maxHeight / sh);
    const attempts = [
      { scale: 1, quality: 0.9 },
      { scale: 0.92, quality: 0.86 },
      { scale: 0.84, quality: 0.81 },
      { scale: 0.76, quality: 0.76 },
    ];
    let fallback: Blob | null = null;
    for (const attempt of attempts) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(256, Math.round(sw * baseScale * attempt.scale));
      canvas.height = Math.max(256, Math.round(sh * baseScale * attempt.scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`${label}预处理画布创建失败`);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const encoded = await canvasBlob(canvas, 'image/webp', attempt.quality)
        || await canvasBlob(canvas, 'image/jpeg', attempt.quality);
      if (!encoded) continue;
      fallback = encoded;
      if (encoded.size <= MAX_REFERENCE_BYTES) return await blobDataUrl(encoded, label);
    }
    if (!fallback) throw new Error(`${label}压缩失败`);
    return await blobDataUrl(fallback, label);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const STORYBOARD_REFERENCE_MAX_BYTES = MAX_REFERENCE_BYTES;
