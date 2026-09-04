import { NextRequest, NextResponse } from 'next/server';
import { createVideoTask } from '@/lib/apimart';
import { createComfyUIDirectorTask, createComfyUIVideoTask, MAX_COMFYUI_REFERENCE_IMAGES } from '@/lib/comfyui';
import { validateDirectorPlan } from '@/lib/h3Director';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { enforceNoSubtitles } from '@/lib/videoTextPolicy';
import { createFalH3MaxVideoTask } from '@/lib/falVideo';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function uploadBase64ToCloudinary(base64Data: string, resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<string> {
  try {
    const result = await uploadToCloudinary(base64Data, {
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
      secondImageRole,
      comfyWorkflowMode,
      directorPlan,
      prompt,
      aspectRatio = '16:9',
      duration,
      quality,
      apiKey,
      videoModel = 'sora-2',
      videoFiles = [],
      audioFiles = [],
      videoUrls = [],
      audioUrls = [],
      imageRoles = [],
      videoProvider = 'apimart',
      comfyui = {},
      fal = {},
    } = await request.json();

    if (!mainImage || !prompt) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }
    const safePrompt = enforceNoSubtitles(prompt);

    if (comfyWorkflowMode === 'director_continuous') {
      if (videoProvider !== 'comfyui') return NextResponse.json({ error: '连续长视频仅支持 ComfyUI H3 Director' }, { status: 400 });
      if ([...referenceImages, ...audioFiles, ...audioUrls, ...videoFiles, ...videoUrls].some(Boolean))
        return NextResponse.json({ error: 'Director 连续长视频当前仅接受一张起始图与原生声音，请清除额外参考素材或切回短视频模式' }, { status: 400 });
      let plan;
      try { plan = validateDirectorPlan(directorPlan, Number(duration), prompt); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '长视频计划无效' }, { status: 400 }); }
      const result = await createComfyUIDirectorTask({ firstFrame: mainImage, plan, aspectRatio, settings: comfyui });
      return NextResponse.json({ success: true, ...result, provider: 'comfyui', message: 'H3 Director 连续长视频已提交；后段承接前段，最终合并为一条视频' });
    }
    if (videoProvider === 'comfyui' && Number(duration) > 15)
      return NextResponse.json({ error: '超过 15 秒请使用 H3 Director 连续长视频，不能由短视频接口截短生成' }, { status: 400 });

    if (videoProvider === 'fal') {
      const endImage = secondImageRole === 'last_frame' ? referenceImages[0] : undefined;
      const result = await createFalH3MaxVideoTask({
        prompt: safePrompt,
        imageUrl: mainImage,
        endImageUrl: endImage,
        duration,
        resolution: fal.resolution || (quality === '480p' ? '480P' : '768P'),
        promptExpansionMode: fal.promptExpansionMode,
        seed: Number.isInteger(fal.seed) ? fal.seed : undefined,
        apiKey: fal.apiKey,
      });
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        provider: 'fal',
        message: 'fal H3 Max 视频任务已提交',
      });
    }

    if (videoProvider === 'comfyui') {
      const audioInputs = [...audioFiles, ...audioUrls].filter(Boolean);
      if (audioInputs.length > 3) {
        return NextResponse.json(
          { error: 'ComfyUI MiniMax H3 最多使用 3 条参考音频' },
          { status: 400 },
        );
      }
      const mode = ['single_reference', 'multi_reference', 'first_last'].includes(comfyWorkflowMode)
        ? comfyWorkflowMode
        : secondImageRole === 'last_frame'
          ? 'first_last'
          : secondImageRole === 'reference'
            ? 'multi_reference'
            : 'single_reference';
      if (mode !== 'single_reference' && !referenceImages[0]) {
        return NextResponse.json(
          { error: mode === 'first_last' ? '首尾帧工作流需要上传尾帧' : '多图参考工作流需要上传第二张参考图' },
          { status: 400 },
        );
      }
      if (mode === 'multi_reference' && referenceImages.length + 1 > MAX_COMFYUI_REFERENCE_IMAGES) {
        return NextResponse.json(
          { error: `ComfyUI MiniMax H3 多图参考最多上传 ${MAX_COMFYUI_REFERENCE_IMAGES} 张图片` },
          { status: 400 },
        );
      }
      const result = await createComfyUIVideoTask({
        firstFrame: mainImage,
        endFrame: mode === 'first_last' ? referenceImages[0] : undefined,
        auxiliaryImages: mode === 'multi_reference' ? referenceImages : [],
        referenceAudios: audioInputs,
        prompt: safePrompt,
        aspectRatio,
        duration: Number(duration) || 5,
        settings: comfyui,
      });
      return NextResponse.json({
        success: true,
        taskId: result.taskId,
        provider: 'comfyui',
        workflow: result.workflow,
        message: 'ComfyUI 视频生成任务已提交',
      });
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

    // 当第二张图作为尾帧时，构建首尾帧角色（模型支持首尾帧模式）
    const effectiveImageRoles = imageRoles.length > 0
      ? imageRoles
      : secondImageRole === 'last_frame' && refImageUrls.length > 0
        ? [
            { url: mainImageUrl, role: 'first_frame' as const },
            { url: refImageUrls[0], role: 'last_frame' as const }
          ]
        : [];

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

    // Build enhanced prompt with audio instructions if audio is provided
    let enhancedPrompt = safePrompt;
    if (uploadedAudioUrls.length > 0) {
      enhancedPrompt = enforceNoSubtitles(`${prompt}

AUDIO: Use the provided reference audio. Natural sound effects only (footsteps, wind, water, fabric, impacts, ambient). No background music. Spoken words remain audio-only and must never be displayed. Maintain the voice timbre and tone of the reference audio exactly as provided.`);
    }

    const taskId = await createVideoTask(
      enhancedPrompt,
      allImageUrls,
      apiKey,
      videoModel,
      aspectRatio,
      {
        duration,
        quality,
        videoUrls: uploadedVideoUrls,
        audioUrls: uploadedAudioUrls,
        imageRoles: effectiveImageRoles.length > 0 ? effectiveImageRoles : undefined
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
