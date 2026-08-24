import { NextRequest, NextResponse } from 'next/server';
import { createProviderImageTask } from '@/lib/imageTaskProvider';
import { imageModelRequiresApiKey } from '@/lib/imageModels';
import { buildCharacterBiblePrompt, buildSceneReferencePrompt } from '@/lib/promptArchitecture';

export async function POST(request: NextRequest) {
  try {
    const { type, name, description, costumeDesc, sceneStyle, referenceImageUrl, aspectRatio, imageModel, apiKey, visualStyle, comfyui = {} } = await request.json();
    const selectedModel = imageModel || 'doubao-seedream-5-0-lite';
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
      prompt = buildSceneReferencePrompt(sceneStyle, visualStyle, aspectRatio || '16:9');
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
    );

    return NextResponse.json({ taskId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate costume image' }, { status: 500 });
  }
}
