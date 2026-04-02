import { NextRequest, NextResponse } from 'next/server';
import { generateStoryboardVideo, waitForVideoGeneration } from '@/lib/videoGenerator';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadAudioToCloudinary(base64Data: string): Promise<string> {
  const result = await cloudinary.uploader.upload(base64Data, {
    folder: 'aid-video',
    resource_type: 'video',
  });
  return result.secure_url;
}

export async function POST(request: NextRequest) {
  try {
    const { storyboard, apiKey, videoModel, aspectRatio, audioFiles = [] } = await request.json();

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

    // 上传音频文件到 Cloudinary
    const uploadedAudioUrls = [];
    for (let i = 0; i < audioFiles.length; i++) {
      console.log(`Uploading audio ${i + 1}...`);
      const audioUrl = await uploadAudioToCloudinary(audioFiles[i]);
      uploadedAudioUrls.push(audioUrl);
      console.log(`Audio ${i + 1} URL:`, audioUrl);
    }

    // 生成视频任务（image-to-video 模式，视觉信息已在图片中）
    const taskId = await generateStoryboardVideo(
      storyboard,
      apiKey,
      videoModel,
      aspectRatio || '16:9',
      uploadedAudioUrls
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
