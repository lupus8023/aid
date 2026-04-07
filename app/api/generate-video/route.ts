import { NextRequest, NextResponse } from 'next/server';
import { generateStoryboardVideo, waitForVideoGeneration } from '@/lib/videoGenerator';

export async function POST(request: NextRequest) {
  try {
    const { storyboard, apiKey, videoModel, aspectRatio, characterAudios = [], firstFrameUrl } = await request.json();

    if (!storyboard) {
      return NextResponse.json(
        { error: 'Storyboard is required' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    console.log('Starting video generation for scene:', storyboard.sceneNumber);
    console.log('Using model:', videoModel || 'sora-2');
    console.log('Aspect ratio:', aspectRatio || '16:9');
    console.log('Image URL:', storyboard.imageUrl);

    // audioFiles are already public URLs (from fish.audio → Cloudinary), pass directly
    const uploadedAudioUrls = characterAudios.map((a: { audioUrl: string }) => a.audioUrl).filter(Boolean);

    // 生成视频任务（image-to-video 模式，视觉信息已在图片中）
    const taskId = await generateStoryboardVideo(
      storyboard,
      apiKey,
      videoModel,
      aspectRatio || '16:9',
      uploadedAudioUrls,
      characterAudios,
      firstFrameUrl
    );
    console.log('Video task created, ID:', taskId);

    // 立即返回 taskId，不等待完成（异步模式）
    // 前端将轮询检查状态
    return NextResponse.json({ taskId, status: 'processing' });
  } catch (error: any) {
    console.error('Generate video API error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return NextResponse.json(
      { error: error.message || 'Failed to generate video' },
      { status: 500 }
    );
  }
}
