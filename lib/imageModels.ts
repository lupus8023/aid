export type ImageGenerationAspectRatio = '16:9' | '9:16' | '1:1' | '4:3';
export type ImageResolutionOverride = '2K' | '4K';

export interface ImageModelCapabilities {
  model: string;
  label: string;
  maxReferenceImages: number;
  maxResolution: '2K' | '4K';
  aspectRatioField: 'size' | 'aspect_ratio';
  responseVersion?: string;
}

const GROK_IMAGE_2 = 'grok-imagine-image-2.0';
export const NANO_BANANA_2 = 'gemini-3.1-flash-image-preview';
export const SEEDREAM_5_PRO = 'seedream-5-0-pro';
export const COMFYUI_Z_IMAGE_TURBO = 'comfyui-z-image-turbo';
export const MIDJOURNEY_IMAGE_MODEL = 'midjourney';

export const APIMART_IMAGE_MODEL_OPTIONS = [
  { value: COMFYUI_Z_IMAGE_TURBO, label: 'ComfyUI · Z-Image-Turbo（本地）' },
  { value: MIDJOURNEY_IMAGE_MODEL, label: 'Midjourney v8.2 · 电影质感（可选 Profile）' },
  { value: SEEDREAM_5_PRO, label: 'Seedream 5.0 Pro · 质量优先' },
  { value: 'doubao-seedance-4-5', label: 'Seedream 4.5（兼容旧设置）' },
  { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
  { value: NANO_BANANA_2, label: 'Nano Banana 2 · Gemini 3.1 Flash' },
  { value: GROK_IMAGE_2, label: 'Grok Imagine 2.0 · Official' },
  { value: 'gpt-image-2', label: 'GPT-Image-2 · 标准快速' },
  { value: 'gpt-image-2-official', label: 'GPT-Image-2 · 官方高保真' },
] as const;

export function isComfyUIZImageTurbo(model: string): boolean {
  return model.trim().toLowerCase() === COMFYUI_Z_IMAGE_TURBO;
}

export function isMidjourneyImageModel(model: string): boolean {
  return model.trim().toLowerCase() === MIDJOURNEY_IMAGE_MODEL;
}

export function storyboardImageMode(model: string): 'single' | 'grid' {
  return isMidjourneyImageModel(model) ? 'single' : 'grid';
}

export function resolveStoryboardGridImageModel(model: string): string {
  if (isMidjourneyImageModel(model)) throw new Error('MJ 分镜必须逐镜生成，不能生成四宫格或自动切换生图模型');
  return model;
}

export function imageModelRequiresApiKey(model: string): boolean {
  return !isComfyUIZImageTurbo(model);
}

export function isGrokImagineImage2(model: string): boolean {
  return model.trim().toLowerCase() === GROK_IMAGE_2;
}

export function isNanoBanana2(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === NANO_BANANA_2
    || normalized === 'nano-banana-2-ext'
    || normalized === 'gemini-3.1-flash-image-preview-official'
    || normalized === 'nano-banana-2';
}

export function isGptImage2Model(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === 'gpt-image-2'
    || normalized === 'gpt-image-2-ext'
    || normalized === 'gpt-image-2-official';
}

export function isOfficialGptImage2(model: string): boolean {
  return model.trim().toLowerCase() === 'gpt-image-2-official';
}

export function getImageModelCapabilities(model: string): ImageModelCapabilities {
  if (isComfyUIZImageTurbo(model)) {
    return {
      model: COMFYUI_Z_IMAGE_TURBO,
      label: 'ComfyUI · Z-Image-Turbo（纯文生图）',
      maxReferenceImages: 0,
      maxResolution: '2K',
      aspectRatioField: 'size',
    };
  }
  if (isMidjourneyImageModel(model)) {
    return {
      model: MIDJOURNEY_IMAGE_MODEL,
      label: 'Midjourney v8.2 · 电影质感（可选 Profile）',
      // APIMart Imagine accepts image_urls as an array. Story reserves the
      // first slot for its environment reference, then adds identity/object
      // anchors without silently dropping the location.
      maxReferenceImages: 4,
      maxResolution: '2K',
      aspectRatioField: 'size',
    };
  }
  if (model.trim().toLowerCase() === SEEDREAM_5_PRO) {
    return {
      model: SEEDREAM_5_PRO,
      label: 'Seedream 5.0 Pro · 质量优先',
      maxReferenceImages: 10,
      maxResolution: '2K',
      aspectRatioField: 'size',
    };
  }
  if (isGrokImagineImage2(model)) {
    return {
      model: GROK_IMAGE_2,
      label: 'Grok Imagine 2.0 · Official',
      maxReferenceImages: 3,
      maxResolution: '2K',
      aspectRatioField: 'aspect_ratio',
      responseVersion: '2026-07-27',
    };
  }
  if (isNanoBanana2(model)) {
    return {
      model,
      label: 'Nano Banana 2 · Gemini 3.1 Flash',
      maxReferenceImages: 14,
      maxResolution: '4K',
      aspectRatioField: 'size',
    };
  }
  return {
    model,
    label: model,
    maxReferenceImages: model.includes('gpt-image') ? 16 : 10,
    maxResolution: '4K',
    aspectRatioField: 'size',
  };
}

export function buildImageGenerationPayload(input: {
  model: string;
  prompt: string;
  aspectRatio: ImageGenerationAspectRatio;
  imageUrls: string[];
  resolutionOverride?: ImageResolutionOverride;
}): { body: Record<string, unknown>; extraHeaders: Record<string, string> } {
  const capabilities = getImageModelCapabilities(input.model);
  const imageUrls = input.imageUrls.slice(0, capabilities.maxReferenceImages);
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    n: 1,
  };

  body[capabilities.aspectRatioField] = input.aspectRatio;
  if (isGrokImagineImage2(input.model)) {
    body.resolution = '2k';
    if (!imageUrls.length) body.quality = 'medium';
  } else if (isGptImage2Model(input.model)) {
    const supports4k = ['16:9', '9:16', '2:1', '1:2', '21:9', '9:21'].includes(input.aspectRatio);
    body.resolution = (input.resolutionOverride || (supports4k ? '4K' : '2K')).toLowerCase();
    // APIMart's official OpenAI route defaults `quality=auto` to roughly the
    // low tier. Story frames are downstream video references, so their skin,
    // material and identity detail needs the explicit high-fidelity tier.
    // The alternate `gpt-image-2` route does not document this field.
    if (isOfficialGptImage2(input.model)) body.quality = 'high';
  } else {
    const requested = input.resolutionOverride || '2K';
    body.resolution = capabilities.maxResolution === '2K' && requested === '4K' ? '2K' : requested;
  }

  if (imageUrls.length) body.image_urls = imageUrls;
  return {
    body,
    extraHeaders: capabilities.responseVersion
      ? { 'X-APIMart-Response-Version': capabilities.responseVersion }
      : {},
  };
}

export function extractImageTaskId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, any>;
  const data = root.data;
  const candidates = [
    Array.isArray(data) ? data[0]?.task_id : undefined,
    Array.isArray(data) ? data[0]?.id : undefined,
    data?.task_id,
    data?.id,
    root.task_id,
    root.id,
  ];
  return String(candidates.find(value => typeof value === 'string' && value.trim()) || '');
}
