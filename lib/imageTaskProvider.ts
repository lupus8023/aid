import { createImageTask, createMidjourneyImageTask } from './apimart';
import { createComfyUIImageTask, type ComfyUIClientSettings } from './comfyui';
import {
  isComfyUIZImageTurbo,
  isMidjourneyImageModel,
  type ImageGenerationAspectRatio,
  type ImageResolutionOverride,
} from './imageModels';
import type { MidjourneyReferenceMode, MidjourneyReferenceOptions } from './midjourney';
import type { MidjourneyTaskMode } from './midjourney';
import type { CapturePreset, VisualStyle } from '@/types';
import { getImageModelCapabilities } from './imageModels';
import { normalizeImageStyleReference, withImageStyleReference, type ImageStyleReference } from './imageStyleReference';

export interface ProviderImageTaskOptions {
  styleReference?: ImageStyleReference;
  midjourneyReferenceMode?: MidjourneyReferenceMode;
  midjourneyTaskMode?: MidjourneyTaskMode;
  midjourneyVisualStyle?: VisualStyle;
  midjourneyCapturePreset?: CapturePreset;
  midjourneyHasPeople?: boolean;
  midjourneyProfile?: string;
  midjourneyReferences?: MidjourneyReferenceOptions;
}

export async function createProviderImageTask(
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  model: string,
  aspectRatio: ImageGenerationAspectRatio,
  resolutionOverride?: ImageResolutionOverride,
  comfyui: ComfyUIClientSettings = {},
  options: ProviderImageTaskOptions = {},
): Promise<string> {
  const style = normalizeImageStyleReference(options.styleReference);
  if (isComfyUIZImageTurbo(model)) {
    if (style) throw new Error('当前文生图模型不支持图片风格参考，请选择支持参考图的模型');
    return (await createComfyUIImageTask({ prompt, aspectRatio, settings: comfyui })).taskId;
  }
  if (isMidjourneyImageModel(model)) {
    return await createMidjourneyImageTask(
      prompt,
      imageUrls,
      apiKey,
      aspectRatio,
      options.midjourneyReferenceMode || 'image',
      options.midjourneyVisualStyle,
      options.midjourneyCapturePreset,
      options.midjourneyTaskMode,
      options.midjourneyHasPeople,
      options.midjourneyProfile,
      style ? { ...options.midjourneyReferences, styleReferenceUrl: style.imageUrl } : options.midjourneyReferences,
    );
  }
  const styled = withImageStyleReference(prompt, imageUrls, style, getImageModelCapabilities(model).maxReferenceImages);
  return await createImageTask(styled.prompt, styled.images, apiKey, model, aspectRatio, resolutionOverride);
}
