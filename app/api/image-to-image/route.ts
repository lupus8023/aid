import { NextRequest, NextResponse } from 'next/server';
import { createProviderImageTask } from '@/lib/imageTaskProvider';
import { buildStudioImagePrompt, imageCreationInputError } from '@/lib/imageCreation';
import { getImageModelCapabilities, imageModelRequiresApiKey, isComfyUIZImageTurbo, isMidjourneyImageModel } from '@/lib/imageModels';
import { buildMidjourneyPrompt } from '@/lib/midjourney';

export async function POST(request: NextRequest) {
  try {
    const { referenceImages, referenceImage, userIntent, scaleNotes, aspectRatio, imageModel, apiKey, visualStyle, comfyui = {}, midjourneyProfile = '' } = await request.json();
    const selectedModel = imageModel || 'seedream-5-0-pro';
    const images = Array.isArray(referenceImages) ? referenceImages : referenceImage ? [referenceImage] : [];
    const usesReferenceImages = !isComfyUIZImageTurbo(selectedModel) && images.length > 0;
    const inputError = imageCreationInputError({
      model: selectedModel,
      referenceCount: images.length,
      userIntent,
    });

    if (inputError) {
      return NextResponse.json({ error: inputError }, { status: 400 });
    }
    const referenceLimit = getImageModelCapabilities(selectedModel).maxReferenceImages;
    if (usesReferenceImages && images.length > referenceLimit) {
      return NextResponse.json({ error: `The selected model supports up to ${referenceLimit} reference images` }, { status: 400 });
    }

    if (imageModelRequiresApiKey(selectedModel) && !apiKey) {
      return NextResponse.json({ error: 'API Key is required' }, { status: 400 });
    }

    const submittedImages = usesReferenceImages ? images : [];
    const prompt = buildStudioImagePrompt({ userIntent, scaleNotes, usesReferenceImages });
    const taskId = await createProviderImageTask(
      prompt,
      submittedImages,
      apiKey,
      selectedModel,
      aspectRatio || '1:1',
      undefined,
      comfyui,
      {
        midjourneyReferenceMode: 'image',
        midjourneyTaskMode: 'single',
        midjourneyVisualStyle: visualStyle,
        midjourneyProfile,
      },
    );

    return NextResponse.json({
      taskId,
      prompt: isMidjourneyImageModel(selectedModel) ? buildMidjourneyPrompt(prompt, { visualStyle, taskMode: 'single' }) : prompt,
    });
  } catch (error) {
    console.error('Image-to-image API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create image-to-image task' },
      { status: 500 }
    );
  }
}
