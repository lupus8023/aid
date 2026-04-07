import { NextRequest, NextResponse } from 'next/server';
import { getVideoTaskStatus } from '@/lib/apimart';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: NextRequest) {
  try {
    const { taskId, apiKey } = await request.json();

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    console.log('Checking video task status:', taskId);

    // 查询视频任务状态
    const status = await getVideoTaskStatus(taskId, apiKey);
    console.log('Video task status:', status.status);

    // 返回状态信息
    const response: any = {
      taskId,
      status: status.status,
    };

    // 如果完成，上传到 Cloudinary 并返回 Cloudinary URL
    if (status.status === 'completed' && status.result?.videos?.[0]?.url) {
      const originalUrl = status.result.videos[0].url;
      try {
        const uploaded = await cloudinary.uploader.upload(originalUrl, {
          folder: 'aid-videos',
          resource_type: 'video',
        });
        response.videoUrl = uploaded.secure_url;
        console.log('Video uploaded to Cloudinary:', response.videoUrl);
      } catch (e) {
        // fallback to original URL if upload fails
        response.videoUrl = originalUrl;
        console.warn('Cloudinary upload failed, using original URL:', originalUrl);
      }
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Check video status API error:', error);
    console.error('Error message:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to check video status' },
      { status: 500 }
    );
  }
}
