import { NextRequest, NextResponse } from 'next/server';
import { getMidjourneyImageStatus, getTaskStatus } from '@/lib/apimart';
import { extractImageTaskError } from '@/lib/imagePromptSafety';
import { downloadComfyUIImageOutput, getComfyUIImageStatus, isComfyUIImageTask } from '@/lib/comfyui';
import { hasCloudinaryUploadTarget, uploadBufferToCloudinary } from '@/lib/cloudinaryUpload';
import { isMidjourneyTask } from '@/lib/midjourney';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { taskId, apiKey, comfyui = {} } = await request.json();

    if (!taskId) {
      return NextResponse.json(
        { error: 'taskId is required' },
        { status: 400 }
      );
    }

    if (isComfyUIImageTask(taskId)) {
      const status = await getComfyUIImageStatus(taskId, comfyui);
      if (status.status !== 'completed' || !status.output) {
        return NextResponse.json({ status: status.status, error: status.error });
      }
      const buffer = await downloadComfyUIImageOutput(taskId, status.output, comfyui);
      if (hasCloudinaryUploadTarget()) {
        const id = taskId.replace(/^comfyui-image:/, '').replace(/[^a-zA-Z0-9_-]/g, '');
        const uploaded = await uploadBufferToCloudinary(buffer, {
          folder: 'aid-images/comfyui-z-image', public_id: id, resource_type: 'image', overwrite: true,
        });
        return NextResponse.json({ status: 'completed', imageUrl: uploaded.secure_url, provider: 'comfyui-z-image' });
      }
      return NextResponse.json({
        status: 'completed',
        imageUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        provider: 'comfyui-z-image',
      });
    }

    if (isMidjourneyTask(taskId)) {
      if (!apiKey) return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
      const status = await getMidjourneyImageStatus(taskId, apiKey);
      if (status.status === 'completed') {
        // The native MJ query exposes the four cropped candidates separately.
        // Never return grid_image_url: downstream video models would interpret
        // the contact sheet as one frame. Automated production uses candidate 1
        // while retaining all four URLs for a future/manual chooser.
        const imageUrl = status.imageUrls[0];
        if (!imageUrl) return NextResponse.json({
          status: 'failed',
          error: 'Midjourney completed without individual candidate images',
        });
        return NextResponse.json({
          status: 'completed',
          imageUrl,
          candidateUrls: status.imageUrls,
          provider: 'midjourney',
        });
      }
      return NextResponse.json({ status: status.status, error: status.error });
    }

    if (!apiKey) return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });

    const status = await getTaskStatus(taskId, apiKey);

    if (status.status === 'completed' && status.result?.images?.[0]?.url) {
      const imageUrl = status.result.images[0].url;
      const finalUrl = Array.isArray(imageUrl) ? imageUrl[0] : imageUrl;
      return NextResponse.json({ status: 'completed', imageUrl: finalUrl });
    }

    if (status.status === 'failed') {
      console.error('Image generation failed:', JSON.stringify(status, null, 2));
      return NextResponse.json({
        status: 'failed',
        error: extractImageTaskError(status),
        details: status
      });
    }

    return NextResponse.json({ status: status.status || 'pending' });
  } catch (error) {
    console.error('Check image status error:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}
