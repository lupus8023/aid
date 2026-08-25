import { NextRequest, NextResponse } from 'next/server';
import { createProviderImageTask } from '@/lib/imageTaskProvider';
import { buildStudioImagePrompt, imageCreationInputError } from '@/lib/imageCreation';
import { getImageModelCapabilities, imageModelRequiresApiKey, isComfyUIZImageTurbo } from '@/lib/imageModels';

export async function POST(request: NextRequest) {
  try {
    const { referenceImages, referenceImage, userIntent, scaleNotes, aspectRatio, imageModel, apiKey, comfyui = {} } = await request.json();
    const selectedModel = imageModel || 'doubao-seedream-5-0-lite';
    const images = Array.isArray(referenceImages) ? referenceImages : referenceImage ? [referenceImage] : [];
    const usesReferenceImages = !isComfyUIZImageTurbo(selectedModel);
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
    );

    return NextResponse.json({ taskId, prompt });
  } catch (error) {
    console.error('Image-to-image API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create image-to-image task' },
      { status: 500 }
    );
  }
}
