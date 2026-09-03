export function buildCloudinaryGridCellUrls(
  secureUrl: string,
  width: number,
  height: number,
  gridSize: 2 | 3 = 2,
): string[] {
  if (!secureUrl.includes('/upload/')) throw new Error('Invalid Cloudinary delivery URL');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < gridSize || height < gridSize) {
    throw new Error('Invalid grid image dimensions');
  }

  const cellWidth = Math.floor(width / gridSize);
  const cellHeight = Math.floor(height / gridSize);
  const inset = Math.max(0, Math.round(Math.min(cellWidth, cellHeight) * 0.045));
  const cropWidth = cellWidth - inset * 2;
  const cropHeight = cellHeight - inset * 2;
  const urls: string[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let column = 0; column < gridSize; column++) {
      const x = column * cellWidth + inset;
      const y = row * cellHeight + inset;
      // Crop from the persisted high-resolution mother, then cap only the
      // delivered derivative. A native 4K 2x2 grid preserves substantially
      // more per-shot detail than the previous 3x3 contact sheet,
      // while q_auto:good keeps each reference compact for browser/Companion.
      const transform = `c_crop,x_${x},y_${y},w_${cropWidth},h_${cropHeight}/c_limit,w_1600,h_1600/q_auto:good,f_auto`;
      urls.push(secureUrl.replace('/upload/', `/upload/${transform}/`));
    }
  }
  return urls;
}

/** A mother grid that this app already persisted in Cloudinary does not need
 * another remote upload. Ask Cloudinary for its metadata and crop the same
 * immutable asset in place. Only accept plain, versioned delivery URLs. */
export function cloudinaryGridInfoUrl(source: string): string | undefined {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password || url.port)
      return undefined;
    if (!/\/image\/upload\/v\d+\//.test(url.pathname)) return undefined;
    url.pathname = url.pathname.replace('/image/upload/', '/image/upload/fl_getinfo/');
    return url.toString();
  } catch { return undefined; }
}

export function cloudinaryGridDimensions(info: unknown): { width: number; height: number } | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const source = (info as { input?: unknown }).input;
  if (!source || typeof source !== 'object') return undefined;
  const width = Number((source as { width?: unknown }).width);
  const height = Number((source as { height?: unknown }).height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined;
}
