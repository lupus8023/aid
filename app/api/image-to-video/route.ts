import { NextRequest, NextResponse } from 'next/server';
import { createVideoTask } from '@/lib/apimart';
import { v2 as cloudinary } from 'cloudinary';

// 配置 Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadBase64ToCloudinary(base64Data: string, resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<string> {
  try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error('Cloudinary credentials not configured');
    }

    const result = await cloudinary.uploader.upload(base64Data, {
      folder: 'aid-video',
      resource_type: resourceType,
    });
    return result.secure_url;
  } catch (error: any) {
    console.error('Cloudinary upload error:', error);
    throw new Error(`Failed to upload ${resourceType}: ${error.message || 'Unknown error'}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      mainImage,
      referenceImages = [],
      prompt,
      aspectRatio = '16:9',
      duration,
      apiKey,
      videoModel = 'sora-2',
      videoFiles = [],
      audioFiles = [],
      videoUrls = [],
      audioUrls = [],
      imageRoles = []
    } = await request.json();

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

    // 上传视频文件
    const uploadedVideoUrls = [...videoUrls];
    for (let i = 0; i < videoFiles.length; i++) {
      console.log(`Uploading video ${i + 1}...`);
      const videoUrl = await uploadBase64ToCloudinary(videoFiles[i], 'video');
      uploadedVideoUrls.push(videoUrl);
      console.log(`Video ${i + 1} URL:`, videoUrl);
    }

    // 上传音频文件
    const uploadedAudioUrls = [...audioUrls];
    for (let i = 0; i < audioFiles.length; i++) {
      console.log(`Uploading audio ${i + 1}...`);
      const audioUrl = await uploadBase64ToCloudinary(audioFiles[i], 'video');
      uploadedAudioUrls.push(audioUrl);
      console.log(`Audio ${i + 1} URL:`, audioUrl);
    }

    console.log('=== Image URLs ===');
    console.log('All image URLs:', allImageUrls);
    console.log('==================');

    const taskId = await createVideoTask(
      prompt,
      allImageUrls,
      apiKey,
      videoModel,
      aspectRatio,
      {
        duration,
        videoUrls: uploadedVideoUrls,
        audioUrls: uploadedAudioUrls,
        imageRoles: imageRoles.length > 0 ? imageRoles : undefined
      }
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
