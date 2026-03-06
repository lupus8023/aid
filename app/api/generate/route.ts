import { NextRequest, NextResponse } from 'next/server';
import { generateStoryboardImage, waitForImageGeneration } from '@/lib/imageGenerator';
import { Storyboard, Character, ObjectItem } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { storyboard, characters, objects, aspectRatio, imageModel, apiKey } = await request.json();

    console.log('=== API Generate Route Debug ===');
    console.log('Received characters:', characters?.length || 0);
    console.log('Received objects:', objects?.length || 0);
    console.log('Objects data:', objects);
    console.log('Storyboard objects field:', storyboard.objects);
    console.log('================================');

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

    // 生成图片任务
    const taskId = await generateStoryboardImage(
      storyboard,
      characters,
      apiKey,
      objects || [],
      aspectRatio || '16:9',
      imageModel
    );

    // 等待图片生成完成
    const imageUrl = await waitForImageGeneration(taskId, apiKey);

    return NextResponse.json({ imageUrl, taskId });
  } catch (error) {
    console.error('Generate API error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate image' },
      { status: 500 }
    );
  }
}
