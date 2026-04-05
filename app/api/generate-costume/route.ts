import { NextRequest, NextResponse } from 'next/server';
import { createImageTask } from '@/lib/apimart';

export async function POST(request: NextRequest) {
  try {
    const { type, name, description, costumeDesc, sceneStyle, referenceImageUrl, aspectRatio, imageModel, apiKey } = await request.json();

    let prompt = '';
    if (type === 'costume') {
      prompt = `Character costume reference sheet. [${name}](${description}) wearing: ${costumeDesc}. Full body shot, neutral pose, white/neutral background, clear visibility of costume details, consistent lighting. No text, no watermark, no labels, no captions.`;
    } else if (type === 'scene') {
      prompt = `Scene environment reference. ${sceneStyle}. Empty scene without characters, establishing shot, wide angle, detailed environment, consistent lighting and atmosphere. No text, no watermark, no labels, no captions.`;
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

    return NextResponse.json({ taskId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate costume image' }, { status: 500 });
  }
}
