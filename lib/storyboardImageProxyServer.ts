import sharp from 'sharp';
// Browser H3 preprocessing needs at most 1600px. Bound the proxy response too,
// so a full 4K PNG cannot exceed hosted-function response limits. This never
// overwrites the saved original or changes its image/task identity.
export async function fitStoryboardProxyImage(bytes: Buffer): Promise<Buffer> {
  const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  for (const quality of [90, 82, 74]) {
    const encoded = await image.clone().webp({ quality }).toBuffer();
    if (encoded.length <= 1_600_000) return encoded;
  }
  throw new Error('分镜预处理图片仍超过安全响应容量，原图已保留');
}
