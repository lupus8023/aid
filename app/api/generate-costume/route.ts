import { NextRequest, NextResponse } from 'next/server';
import { createImageTask, getTaskStatus } from '@/lib/apimart';

// Poll until image task completes, return URL
async function pollImage(taskId: string, apiKey: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const data = await getTaskStatus(taskId, apiKey);
    if (data.status === 'completed' && data.result?.images?.[0]?.url) {
      return data.result.images[0].url;
    }
    if (data.status === 'failed') throw new Error('Image generation failed');
  }
  throw new Error('Image generation timeout');
}

export async function POST(request: NextRequest) {
  try {
    const { type, name, description, costumeDesc, sceneStyle, referenceImageUrl, aspectRatio, imageModel, apiKey } = await request.json();

    let prompt = '';
    if (type === 'costume') {
      prompt = `Character costume reference sheet. [${name}](${description}) wearing: ${costumeDesc}. Full body shot, neutral pose, white/neutral background, clear visibility of costume details, consistent lighting. This is a costume reference for film production. No text, no watermark, no labels, no captions.`;
    } else if (type === 'scene') {
      prompt = `Scene environment reference. ${sceneStyle}. Empty scene without characters, establishing shot, wide angle, detailed environment, consistent lighting and atmosphere. This is a scene reference for film production. No text, no watermark, no labels, no captions.`;
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const taskId = await createImageTask(
      prompt,
      referenceImageUrl ? [referenceImageUrl] : [],
      apiKey,
      imageModel || 'doubao-seedream-5-0-lite',
      aspectRatio || '16:9'
    );

    const imageUrl = await pollImage(taskId, apiKey);
    return NextResponse.json({ imageUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate costume image' }, { status: 500 });
  }
}
