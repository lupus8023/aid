import { createImageTask } from './apimart';
import { createComfyUIImageTask, type ComfyUIClientSettings } from './comfyui';
import {
  isComfyUIZImageTurbo,
  type ImageGenerationAspectRatio,
  type ImageResolutionOverride,
} from './imageModels';

export async function createProviderImageTask(
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  model: string,
  aspectRatio: ImageGenerationAspectRatio,
  resolutionOverride?: ImageResolutionOverride,
  comfyui: ComfyUIClientSettings = {},
): Promise<string> {
  if (isComfyUIZImageTurbo(model)) {
    return (await createComfyUIImageTask({ prompt, aspectRatio, settings: comfyui })).taskId;
  }
  return await createImageTask(prompt, imageUrls, apiKey, model, aspectRatio, resolutionOverride);
}
