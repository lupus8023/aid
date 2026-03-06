import { NextRequest, NextResponse } from 'next/server';
import { createVideoTask } from '@/lib/apimart';
import { v2 as cloudinary } from 'cloudinary';

// 配置 Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadBase64ToCloudinary(base64Data: string): Promise<string> {
  try {
    const result = await cloudinary.uploader.upload(base64Data, {
      folder: 'aid-video',
      resource_type: 'image',
    });
    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { mainImage, referenceImages = [], prompt, aspectRatio = '16:9', apiKey, videoModel = 'sora-2' } = await request.json();

    if (!mainImage || !prompt) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: '未配置 API Key' }, { status: 500 });
    }

    console.log('Uploading main image to Cloudinary...');
    const mainImageUrl = await uploadBase64ToCloudinary(mainImage);
    console.log('Main image URL:', mainImageUrl);

    const refImageUrls: string[] = [];
    for (let i = 0; i < referenceImages.length; i++) {
      console.log(`Uploading reference image ${i + 1}...`);
      const refUrl = await uploadBase64ToCloudinary(referenceImages[i]);
      refImageUrls.push(refUrl);
      console.log(`Reference image ${i + 1} URL:`, refUrl);
    }

    const allImageUrls = [mainImageUrl, ...refImageUrls];

    console.log('=== Image URLs ===');
    console.log('All image URLs:', allImageUrls);
    console.log('==================');

    const taskId = await createVideoTask(
      prompt,
      allImageUrls,
      apiKey,
      videoModel,
      aspectRatio
    );

    return NextResponse.json({
      success: true,
      taskId,
      message: '视频生成任务已创建'
    });

  } catch (error) {
    console.error('Image to video error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '视频生成失败' },
      { status: 500 }
    );
  }
}
