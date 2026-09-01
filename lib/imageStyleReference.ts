export interface ImageStyleReference {
  imageUrl: string;
  description?: string;
  version?: number;
}

export function normalizeImageStyleReference(value: unknown): ImageStyleReference | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('风格参考格式无效');
  const input = value as ImageStyleReference;
  const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
  const url = new URL(imageUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('风格参考需要已上传的图片地址');
  return { imageUrl, description: typeof input.description === 'string' ? input.description.trim().slice(0, 1600) : undefined };
}

export function imageStyleDirection(style: ImageStyleReference, referenceNumber?: number): string {
  return `SERIES COLOR AND CINEMATOGRAPHY REFERENCE:
${referenceNumber ? `Reference image ${referenceNumber} is STYLE ONLY, not a character, object or location reference.` : 'Use the established series style carried by the approved input frames.'}
Borrow only cultural/art-direction atmosphere, palette, warm/cool balance, contrast, broad lens character and lighting mood. ${style.description || ''}
Do not copy its person, face, hair, costume, pose, scenery, composition or weather. Do not inherit its artistic medium or rendering method; the selected output medium takes priority, including live-action photography when selected. Respect authored shot size, camera movement, time of day and actual light sources. Identity references control the cast; environment references control geography. Apply this reference's color and mood instead of generic color presets.`;
}

export function withImageStyleReference(prompt: string, images: string[], style: ImageStyleReference | undefined, maxReferences: number) {
  if (!style) return { prompt, images };
  if (images.length >= maxReferences) throw new Error('参考图已满，需为全系列风格图保留一个名额；未丢弃角色参考');
  // Append even when the same URL is also an identity: reference roles are distinct.
  return { prompt: `${prompt}\n\n${imageStyleDirection(style, images.length + 1)}`, images: [...images, style.imageUrl] };
}
