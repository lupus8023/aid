import { NextRequest, NextResponse } from 'next/server';
import { createImageTask } from '@/lib/apimart';
import { buildCharacterBiblePrompt, buildSceneReferencePrompt } from '@/lib/promptArchitecture';

export async function POST(request: NextRequest) {
  try {
    const { type, name, description, costumeDesc, sceneStyle, referenceImageUrl, aspectRatio, imageModel, apiKey, visualStyle } = await request.json();

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
      prompt = buildSceneReferencePrompt(sceneStyle, visualStyle);
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const taskId = await createImageTask(
      prompt,
      referenceImageUrl ? [referenceImageUrl] : [],
      apiKey,
      imageModel || 'doubao-seedream-5-0-lite',
      type === 'costume' ? '4:3' : (aspectRatio || '16:9')
    );

    return NextResponse.json({ taskId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate costume image' }, { status: 500 });
  }
}
