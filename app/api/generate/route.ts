import { NextRequest, NextResponse } from 'next/server';
import { generateStoryboardImage } from '@/lib/imageGenerator';
import { Storyboard, Character, ObjectItem } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { storyboard, characters, objects, aspectRatio, imageModel, apiKey, costumeImages, sceneImage } = await request.json();

    if (!storyboard || !characters || characters.length === 0) {
      return NextResponse.json(
        { error: 'Storyboard and characters are required' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key is required' },
        { status: 400 }
      );
    }

    const taskId = await generateStoryboardImage(
      storyboard,
      characters,
      apiKey,
      objects || [],
      aspectRatio || '16:9',
      imageModel,
      costumeImages || {},
      sceneImage
    );

    return NextResponse.json({ taskId });
  } catch (error) {
    console.error('Generate API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate image' },
      { status: 500 }
    );
  }
}
