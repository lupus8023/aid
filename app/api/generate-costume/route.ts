import { NextRequest, NextResponse } from 'next/server';
import { createProviderImageTask } from '@/lib/imageTaskProvider';
import { imageModelRequiresApiKey, isMidjourneyImageModel } from '@/lib/imageModels';
import { buildCharacterBiblePrompt, buildSceneReferencePrompt, buildStoryWorldAnchorPrompt } from '@/lib/promptArchitecture';

export async function POST(request: NextRequest) {
  try {
    const { type, name, description, costumeDesc, sceneStyle, representativeShot, storyCharacterNames, referenceImageUrl, aspectRatio, imageModel, apiKey, visualStyle, capturePreset, comfyui = {}, midjourneyProfile = '' } = await request.json();
    const selectedModel = imageModel || 'seedream-5-0-pro';
    if (imageModelRequiresApiKey(selectedModel) && !apiKey) return NextResponse.json({ error: 'API Key is required' }, { status: 400 });

    let prompt = '';
    if (type === 'costume') {
      prompt = buildCharacterBiblePrompt({
        name,
        description,
        costumeDesc,
        hasIdentityReference: Boolean(referenceImageUrl),
        visualStyle,
      });
    } else if (type === 'scene') {
      prompt = isMidjourneyImageModel(selectedModel)
        ? buildStoryWorldAnchorPrompt({
            sceneStyle,
            representativeShot,
            characterNames: Array.isArray(storyCharacterNames) ? storyCharacterNames : [],
            visualStyle,
            capturePreset,
            aspectRatio: aspectRatio || '16:9',
          })
        : buildSceneReferencePrompt(sceneStyle, visualStyle, aspectRatio || '16:9', capturePreset);
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const taskId = await createProviderImageTask(
      prompt,
      referenceImageUrl ? [referenceImageUrl] : [],
      apiKey,
      selectedModel,
      type === 'costume' ? '4:3' : (aspectRatio || '16:9'),
      undefined,
      comfyui,
      {
        midjourneyReferenceMode: type === 'costume' ? 'character' : isMidjourneyImageModel(selectedModel) ? 'image' : 'style',
        midjourneyTaskMode: type === 'costume' ? 'character-sheet' : isMidjourneyImageModel(selectedModel) ? 'story-shot' : 'single',
        midjourneyVisualStyle: visualStyle,
        midjourneyCapturePreset: type === 'scene' ? capturePreset : undefined,
        midjourneyHasPeople: type === 'costume' || (isMidjourneyImageModel(selectedModel) && Array.isArray(storyCharacterNames) && storyCharacterNames.length > 0),
        midjourneyProfile,
      },
    );

    return NextResponse.json({ taskId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate costume image' }, { status: 500 });
  }
}
