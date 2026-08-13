import { NextRequest, NextResponse } from 'next/server';
import { getVideoTaskStatus } from '@/lib/apimart';
import { v2 as cloudinary } from 'cloudinary';
import { downloadComfyUIOutput, getComfyUIVideoStatus, isComfyUITask } from '@/lib/comfyui';

export const runtime = 'nodejs';
export const maxDuration = 300;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: NextRequest) {
  try {
    const { taskId, apiKey, comfyui = {}, localDelivery = false } = await request.json();

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (isComfyUITask(taskId)) {
      const status = await getComfyUIVideoStatus(taskId, comfyui);
      if (status.status !== 'completed' || !status.output) {
        return NextResponse.json({
          taskId,
          status: status.status,
          error: status.error,
          stage: status.stage,
          progress: status.progress,
          currentSegment: status.currentSegment,
          completedSegments: status.completedSegments,
          totalSegments: status.totalSegments,
        });
      }
      if (localDelivery) {
        return NextResponse.json({
          taskId,
          status: 'completed',
          readyForDownload: true,
          provider: 'comfyui',
          progress: 100,
          currentSegment: status.currentSegment,
          completedSegments: status.completedSegments,
          totalSegments: status.totalSegments,
        });
      }
      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return NextResponse.json(
          { taskId, status: 'failed', error: 'ComfyUI 输出需要配置 Cloudinary 才能回传到浏览器' },
          { status: 500 },
        );
      }
      const buffer = await downloadComfyUIOutput(taskId, status.output, comfyui);
      const promptId = taskId.replace(/^comfyui(?:-long)?:/, '').replace(/[^a-zA-Z0-9_-]/g, '');
      const uploaded: any = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'aid-videos/comfyui', public_id: promptId, resource_type: 'video', overwrite: true },
          (error, result) => error ? reject(error) : resolve(result),
        );
        stream.end(buffer);
      });
      return NextResponse.json({ taskId, status: 'completed', videoUrl: uploaded.secure_url, provider: 'comfyui' });
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
      let originalUrl = status.result.videos[0].url;
      // Handle case where url is an array
      if (Array.isArray(originalUrl)) {
        originalUrl = originalUrl[0];
      }
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
