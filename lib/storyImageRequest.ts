import type { Character, ObjectItem, Storyboard, VisualStyle, CapturePreset } from '@/types';
import type { ComfyUIClientSettings } from './comfyui';
import type { ImageStyleReference } from './imageStyleReference';
import type { MidjourneyStyleReference } from './midjourney';
import { ApiResponseError, readApiJson } from './apiResponse';
import { visibleImageCast, type ImageCastCharacter } from './series/imageCastContract';

export const MAX_STORY_IMAGE_REQUEST_BYTES = 1024 * 1024;
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;

interface StoryImageRequest {
  storyboard: Storyboard;
  characters: Character[];
  objects: ObjectItem[];
  costumeImages?: Record<string, string>;
  sceneImage?: string;
  referenceImages?: string[];
  referenceImageLabels?: string[];
  aspectRatio: string;
  imageModel: string;
  apiKey: string;
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  comfyui?: ComfyUIClientSettings;
  styleReference?: ImageStyleReference;
  midjourneyStyle?: MidjourneyStyleReference;
  midjourneyProfile?: string;
}

function remoteImageUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** Only upload browser-local bytes. Remote sources are never downloaded or
 * recompressed here. The signed upload bypasses our serverless body limit. */
async function uploadReference(source: string, request: typeof fetch, localUpload: boolean): Promise<string> {
  if (!/^(?:data:image\/(?:png|jpeg|webp);base64,|blob:)/i.test(source)) {
    throw new Error('参考图缺少可用的图片地址，请重新上传 PNG、JPEG 或 WebP 图片');
  }
  // Bound data URLs before decoding their entire contents.
  if (source.startsWith('data:') && source.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4 + 100) {
    throw new ApiResponseError('参考图超过 50 MB，请重新上传较小的源文件；尚未提交生成', 'REQUEST_TOO_LARGE', 413);
  }
  const imageResponse = await request(source);
  if (!imageResponse.ok) throw new Error('本地参考图已失效，请重新上传；尚未提交生成');
  const blob = await imageResponse.blob();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || !blob.size) {
    throw new Error('参考图为空或格式无效，请上传 PNG、JPEG 或 WebP 图片');
  }
  if (blob.size > MAX_REFERENCE_BYTES) throw new ApiResponseError('参考图超过 50 MB；尚未提交生成', 'REQUEST_TOO_LARGE', 413);
  // Packaged local pages have no storage credentials or cross-origin signing
  // access. Their existing multipart endpoint relays through scoped signing.
  // Hosted pages must upload directly: this route shares the gateway limit.
  if (localUpload) {
    const form = new FormData();
    form.append('image', blob, 'reference');
    const response = await request('/api/upload-image', { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    const data = await readApiJson<{ url?: string }>(response, '参考图上传失败');
    if (typeof data.url === 'string' && remoteImageUrl(data.url)) return data.url;
    throw new Error('参考图上传未返回有效图片地址；尚未提交生成');
  }
  const signing = await request('/api/media-upload/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: 'aid-images', resource_type: 'image' }),
    signal: AbortSignal.timeout(20_000),
  });
  const ticket = await readApiJson<{ targets?: Array<{ url: string; fields: Record<string, string> }> }>(signing, '准备参考图上传失败');
  const targets = ticket.targets;
  if (!Array.isArray(targets) || !targets.length || targets.some(target =>
    !target || typeof target.url !== 'string'
    || !/^https:\/\/api\.cloudinary\.com\/v1_1\/[a-zA-Z0-9_-]+\/image\/upload$/.test(target.url)
    || !target.fields?.signature || Object.values(target.fields).some(value => typeof value !== 'string'))) {
    throw new Error('参考图上传签名无效；尚未提交生成');
  }
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const form = new FormData();
    for (const [key, value] of Object.entries(target.fields)) form.append(key, value);
    form.append('file', blob, 'reference');
    const response = await request(target.url, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(120_000) });
    const data = await response.json().catch(() => ({}));
    if (response.ok && typeof data.secure_url === 'string' && data.secure_url.startsWith('https://') && remoteImageUrl(data.secure_url)) return data.secure_url;
    const message = String(data.error?.message || '参考图上传失败；尚未提交生成');
    if (response.status === 413 || /file size too large|image size.*exceeds|maximum.*file size/i.test(message)) {
      throw new ApiResponseError('参考图超过存储服务的文件大小限制；尚未提交生成，请更换较小的源文件', 'REQUEST_TOO_LARGE', 413);
    }
    // A configured backup may handle storage/account exhaustion, not an
    // uncertain transport failure or a rejected/invalid source image.
    const accountUnavailable = [401, 403, 420, 429].includes(response.status) || /quota|usage limit|storage limit|bandwidth limit|account.*(?:disabled|suspended)/i.test(message);
    if (!accountUnavailable || index + 1 === targets.length) throw new Error(message);
  }
  throw new Error('参考图上传失败；尚未提交生成');
}

/** One preparer per Story page: shared references are uploaded once across
 * batches/retries. Failed uploads are evicted; the saved project is untouched. */
export function createStoryImageRequestPreparer(
  request: typeof fetch = fetch,
  localUpload = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname),
) {
  const uploads = new Map<string, Promise<string>>();
  const resolve = (source: string): Promise<string> => {
    if (!source || remoteImageUrl(source)) return Promise.resolve(source);
    let pending = uploads.get(source);
    if (!pending) {
      pending = uploadReference(source, request, localUpload).catch(error => { uploads.delete(source); throw error; });
      uploads.set(source, pending);
    }
    return pending;
  };
  return async (input: StoryImageRequest): Promise<string> => {
    const board = input.storyboard;
    const cast = visibleImageCast(board, input.characters);
    const objects = input.objects.filter(object => board.objects?.includes(object.name));
    const sourceOf = (item: Character | ObjectItem) => remoteImageUrl(item.imageUrl || '')
      ? item.imageUrl : item.imageBase64 || item.imageUrl || '';
    const fallbackSources = new Map([...cast, ...objects].filter(item => item.imageUrl?.startsWith('blob:') && item.imageBase64)
      .map(item => [item.imageUrl, item.imageBase64!]));
    const references = input.referenceImages || [];
    const explicitReferences = references.length > 0;
    // Keep array order AND duplicates: the same image can serve distinct roles.
    const resolvedReferences = await Promise.all(references.map(source => resolve(fallbackSources.get(source) || source)));
    const resolvedBySource = new Map(references.map((source, i) => [fallbackSources.get(source) || source, resolvedReferences[i]]));
    const metadataImage = (source: string) => explicitReferences
      ? Promise.resolve(resolvedBySource.get(source) || (remoteImageUrl(source) ? source : ''))
      : resolve(source);
    const costumes: Record<string, string> = {};
    const visible = new Set(cast);
    // Keep lightweight cast metadata (including the empty-shot case required
    // by older Companion APIs), but never upload an off-shot character image.
    const characters = await Promise.all(input.characters.map(async character => {
      const costume = input.costumeImages?.[character.name];
      const imageUrl = visible.has(character) ? await metadataImage(costume || sourceOf(character)) : '';
      if (!explicitReferences && costume && visible.has(character)) costumes[character.name] = imageUrl;
      return { id: character.id, name: character.name, description: character.description, imageUrl, appearance: (character as ImageCastCharacter).appearance };
    }));
    const preparedObjects = await Promise.all(objects.map(async object => ({
      id: object.id, name: object.name, description: object.description,
      imageUrl: await metadataImage(sourceOf(object)),
    })));
    const sceneImage = explicitReferences ? '' : await resolve(board.sceneImageOverride || input.sceneImage || '');
    const body = JSON.stringify({
      storyboard: {
        id: board.id, sceneNumber: board.sceneNumber, status: board.status,
        prompt: board.prompt, description: board.description, action: board.action,
        characters: board.characters, objects: board.objects,
        characterCostume: board.characterCostume, sceneStyle: board.sceneStyle,
        shotSize: board.shotSize, angle: board.angle, cameraMove: board.cameraMove,
        capturePreset: board.capturePreset,
      },
      characters, objects: preparedObjects, costumeImages: costumes, sceneImage,
      referenceImages: resolvedReferences, referenceImageLabels: input.referenceImageLabels || [],
      aspectRatio: input.aspectRatio, imageModel: input.imageModel, apiKey: input.apiKey,
      visualStyle: input.visualStyle, capturePreset: input.capturePreset, comfyui: input.comfyui,
      styleReference: input.styleReference ? {
        imageUrl: await resolve(input.styleReference.imageUrl), description: input.styleReference.description,
      } : undefined,
      midjourneyStyle: input.midjourneyStyle ? {
        styleReferenceUrl: await resolve(input.midjourneyStyle.styleReferenceUrl || ''), styleWeight: input.midjourneyStyle.styleWeight,
      } : undefined,
      midjourneyProfile: input.midjourneyProfile,
    });
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > MAX_STORY_IMAGE_REQUEST_BYTES) throw new ApiResponseError(`生图请求数据过大（${(bytes / 1024 / 1024).toFixed(2)} MB）；参考图已单独上传，请检查异常长度的分镜或角色描述。尚未提交生成`, 'REQUEST_TOO_LARGE', 413);
    return body;
  };
}
