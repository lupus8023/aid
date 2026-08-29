import { createImageTask, createMidjourneyImageTask } from './apimart';
import { createComfyUIImageTask, type ComfyUIClientSettings } from './comfyui';
import {
  isComfyUIZImageTurbo,
  isMidjourneyImageModel,
  type ImageGenerationAspectRatio,
  type ImageResolutionOverride,
} from './imageModels';
import type { MidjourneyReferenceMode } from './midjourney';
import type { MidjourneyTaskMode } from './midjourney';
import type { CapturePreset, VisualStyle } from '@/types';

export interface ProviderImageTaskOptions {
  midjourneyReferenceMode?: MidjourneyReferenceMode;
  midjourneyTaskMode?: MidjourneyTaskMode;
  midjourneyVisualStyle?: VisualStyle;
  midjourneyCapturePreset?: CapturePreset;
  midjourneyHasPeople?: boolean;
  midjourneyProfile?: string;
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
  if (isComfyUIZImageTurbo(model)) {
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
    );
  }
  return await createImageTask(prompt, imageUrls, apiKey, model, aspectRatio, resolutionOverride);
}
