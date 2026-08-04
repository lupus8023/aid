import axios from 'axios';
import { ApiMartChatResponse, ApiMartImageTaskResponse, ApiMartImageStatusResponse, ApiMartVideoStatusResponse } from '@/types';

const APIMART_BASE_URL = 'https://api.apimart.ai/v1';

// 聊天 API - 用于分析故事
export async function chatCompletion(prompt: string, apiKey: string, model: string = 'gpt-4o'): Promise<string> {
  try {
    const response = await axios.post<ApiMartChatResponse>(
      `${APIMART_BASE_URL}/chat/completions`,
      {
        model,
        stream: false,
        max_tokens: 16000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('API Response:', JSON.stringify(response.data, null, 2));

    // Handle SSE format response (": PING\n\n{...json...}")
    let rawData = response.data as any;
    if (typeof rawData === 'string') {
      const jsonMatch = rawData.match(/\{[\s\S]*\}/);
      if (jsonMatch) rawData = JSON.parse(jsonMatch[0]);
    }

    const content = rawData?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`Unexpected API response format: ${JSON.stringify(rawData)}`);
    }
    return content;
  } catch (error: any) {
    console.error('Chat API error:', error);
    console.error('Error details:', error.response?.data);
    console.error('Status:', error.response?.status);
    throw new Error(`Failed to call chat API: ${error.response?.data?.error?.message || error.message}`);
  }
}

// 图像生成 API - 创建任务
export async function createImageTask(
  prompt: string,
  referenceImageUrls: string | string[],
  apiKey: string,
  model: string = 'doubao-seedream-5-0-lite',
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' = '16:9'
): Promise<string> {
  try {
    const rawUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls
      : [referenceImageUrls];

    // 将 base64 图片上传到 APIMart 获取公网 URL
    const imageUrls: string[] = [];
    for (let i = 0; i < rawUrls.length; i++) {
      const img = rawUrls[i];
      if (!img) continue;

      try {
        if (img.startsWith('data:')) {
          const url = await uploadImageToPublic(img, apiKey);
          imageUrls.push(ensureCloudinaryMinHeight(url));
          console.log(`Image ${i + 1}/${rawUrls.length} uploaded successfully: ${url}`);
        } else {
          imageUrls.push(ensureCloudinaryMinHeight(img));
          console.log(`Image ${i + 1}/${rawUrls.length} is already a URL: ${img}`);
        }
      } catch (error) {
        console.error(`Failed to upload image ${i + 1}/${rawUrls.length}:`, error);
        // 继续处理其他图片，不中断整个流程
      }
    }

    const requestBody: any = {
      model,
      prompt,
      size: aspectRatio,
      n: 1
    };

    if (model.includes('gpt-image')) {
      // 4k 仅支持 16:9, 9:16, 2:1, 1:2, 21:9, 9:21；1:1 等比例用 2k
      const supports4k = ['16:9', '9:16', '2:1', '1:2', '21:9', '9:21'].includes(aspectRatio);
      requestBody.resolution = supports4k ? '4k' : '2k';
    } else {
      requestBody.resolution = '2K';
    }

    if (imageUrls.length > 0 && imageUrls[0]) {
      requestBody.image_urls = imageUrls;
    }

    console.log('=== Image Generation Request ===');
    console.log('Model:', model);
    console.log('Prompt length:', prompt.length);
    console.log('Reference images:', imageUrls.length);
    console.log('Request Body:', JSON.stringify({
      ...requestBody,
      prompt: prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt,
      image_urls: imageUrls.map(url => url.substring(0, 50) + '...')
    }, null, 2));
    console.log('================================');

    const response = await axios.post(
      `${APIMART_BASE_URL}/images/generations`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.data[0].task_id;
  } catch (error: any) {
    console.error('Image generation API error:', error);
    console.error('Error response:', error.response?.data);
    console.error('Error status:', error.response?.status);
    console.error('Error headers:', error.response?.headers);

    const errorMsg = error.response?.data?.error?.message || error.message;
    throw new Error(`Failed to create image generation task: ${errorMsg}`);
  }
}

// 查询任务状态
export async function getTaskStatus(taskId: string, apiKey: string): Promise<ApiMartImageStatusResponse> {
  try {
    const response = await axios.get(
      `${APIMART_BASE_URL}/tasks/${taskId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    console.log(`Task ${taskId} raw response:`, JSON.stringify(response.data, null, 2));

    // API 响应格式可能是 { code: 200, data: { task_id, status, result } }
    // 类似于 createImageTask 的响应格式
    if (response.data.data) {
      return response.data.data;
    }

    return response.data;
  } catch (error) {
    console.error('Task status API error:', error);
    throw new Error('Failed to get task status');
  }
}

// Seedance/Doubao 要求图片高度 >= 300px，对 Cloudinary URL 加条件缩放
function ensureCloudinaryMinHeight(url: string): string {
  if (!url.includes('res.cloudinary.com/')) return url;
  return url.replace('/upload/', '/upload/if_h_lt_300/c_scale,h_300/if_end/');
}

// Seedance/Doubao 要求音频时长在 1.8s–15.2s，对 Cloudinary URL 加条件处理
function ensureCloudinaryAudioDuration(url: string): string {
  if (!url.includes('res.cloudinary.com/')) return url;
  return url.replace('/upload/', '/upload/if_du_lt_1.8/du_1.8/if_end/eo_15.2/');
}

/**
 * 将期望时长（秒）对齐到指定模型允许的最近合法值。
 */
export function snapDurationToModel(desiredSeconds: number, model: string): number {
  const m = model.toLowerCase();
  if (m.includes('omni-flash-ext')) {
    const steps = [4, 6, 8, 10];
    return steps.reduce((prev, cur) =>
      Math.abs(cur - desiredSeconds) < Math.abs(prev - desiredSeconds) ? cur : prev
    );
  }
  if (m.includes('grok-imagine')) {
    return Math.min(30, Math.max(6, Math.round(desiredSeconds)));
  }
  if (m.includes('veo3') || m.includes('veo 3')) {
    return 8; // 固定8秒
  }
  if (m.includes('wan2.6')) {
    // 只支持 5 / 10 / 15 秒
    const steps = [5, 10, 15];
    return steps.reduce((prev, cur) =>
      Math.abs(cur - desiredSeconds) < Math.abs(prev - desiredSeconds) ? cur : prev
    );
  }
  if (m.includes('wan2') || m.includes('wan ') || m.includes('happyhorse')) {
    // wan2.7: 2–15s
    return Math.min(15, Math.max(2, Math.round(desiredSeconds)));
  }
  if (m.includes('seedance-2') || m.includes('seedance-4') || m.includes('seedance-5')) {
    // seedance 2.0: 4–15s
    return Math.min(15, Math.max(4, Math.ceil(desiredSeconds)));
  }
  if (m.includes('seedance-1') || m.includes('doubao')) {
    // seedance 1.x: 4–12s
    return Math.min(12, Math.max(4, Math.ceil(desiredSeconds)));
  }
  if (m.includes('minimax-h3')) {
    // MiniMax-H3: 4–15s
    return Math.min(15, Math.max(4, Math.round(desiredSeconds)));
  }
  // sora-2 / 其他：5–10s
  return Math.min(10, Math.max(5, Math.round(desiredSeconds)));
}

// 视频生成 API - 创建任务
export async function createVideoTask(
  prompt: string,
  referenceImageUrls: string[],
  apiKey: string,
  model: string = 'sora-2',
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
  options?: {
    duration?: number;
    videoUrls?: string[];
    audioUrls?: string[];
    generateAudio?: boolean;
    imageRoles?: Array<{ url: string; role: 'first_frame' | 'last_frame' }>;
    resolution?: '720P' | '1080P';
    quality?: '480p' | '720p';
  }
): Promise<string> {
  try {
    console.log('=== Video Generation Debug ===');
    console.log('Model:', model);
    console.log('Model includes doubao:', model.includes('doubao'));
    console.log('Model includes seedance:', model.includes('seedance'));
    console.log('==============================');

    const requestBody: any = {
      model,
      prompt,
      duration: options?.duration ?? (model.includes('sora-2') ? 10 : 5),
    };

    const isHappyHorse = model.includes('happyhorse');
    const isOmniFlashExt = model.toLowerCase().includes('omni-flash-ext');
    const isGrokImagine = model.toLowerCase().includes('grok-imagine');
    const isDoubaoSeedance = model.includes('doubao') || model.includes('seedance');
    const isMiniMaxH3 = model.toLowerCase().includes('minimax-h3');

    // Grok Imagine 使用 /videos/generations 的 size + quality + image_urls 参数格式
    if (isGrokImagine) {
      requestBody.size = aspectRatio;
      requestBody.quality = options?.quality ?? '480p';
      // Duration: 6-30秒
      const rawDuration = options?.duration ?? 6;
      requestBody.duration = Math.max(6, Math.min(30, rawDuration));
      // Support up to 7 reference images
      if (referenceImageUrls.length > 0) {
        requestBody.image_urls = referenceImageUrls.slice(0, 7);
      }
    } else if (isOmniFlashExt) {
      requestBody.aspect_ratio = aspectRatio;
      requestBody.resolution = (options?.resolution ?? '1080p').toLowerCase();
      // Omni-Flash-Ext 只支持 4/6/8/10 秒，需要映射其他值
      const rawDuration = options?.duration ?? 6;
      if ([4, 6, 8, 10].includes(rawDuration)) {
        requestBody.duration = rawDuration;
      } else {
        // 将其他值映射到最接近的支持值
        requestBody.duration = rawDuration <= 4 ? 4 : rawDuration <= 6 ? 6 : rawDuration <= 8 ? 8 : 10;
      }
    } else if (model.includes('wan2') || isHappyHorse) {
      // wan2.7 / HappyHorse 使用 size + resolution 参数
      requestBody.size = aspectRatio;
      requestBody.resolution = options?.resolution ?? '1080P';
    } else if (model.includes('doubao') || model.includes('seedance')) {
      // Doubao Seedance 使用 size 参数
      requestBody.size = aspectRatio;
    } else if (isMiniMaxH3) {
      // MiniMax-H3: aspect_ratio + resolution 2K (only 2K supported) + duration 4–15s
      requestBody.aspect_ratio = aspectRatio;
      requestBody.resolution = '2K';
      const rawDuration = options?.duration ?? 5;
      requestBody.duration = Math.min(15, Math.max(4, rawDuration));
    } else {
      requestBody.aspect_ratio = aspectRatio;
    }

    // 根据模型类型应用参考图
    if (isGrokImagine) {
      // Already handled above in Grok Imagine block
    } else if (isOmniFlashExt) {
      // Omni-Flash-Ext: 支持 0/1/3 张参考图
      if (referenceImageUrls.length > 0 && referenceImageUrls.length !== 2) {
        requestBody.image_urls = referenceImageUrls;
      }
      // 2 张图片不被支持，会返回错误
    } else if (isHappyHorse) {
      // HappyHorse 只支持 first_frame_image（无尾帧参数），且与 image_urls 互斥
      if (options?.imageRoles && options.imageRoles.length > 0) {
        const firstFrame = options.imageRoles.find(img => img.role === 'first_frame');
        if (firstFrame) requestBody.first_frame_image = firstFrame.url;
      } else if (referenceImageUrls.length === 1) {
        requestBody.first_frame_image = referenceImageUrls[0];
      } else if (referenceImageUrls.length > 1) {
        // R2V 参考图模式：1~9 张
        requestBody.image_urls = referenceImageUrls.slice(0, 9);
      }
    } else if (isMiniMaxH3) {
      // MiniMax-H3: I2V 和 R2V 模式严格互斥
      // 有音频 → R2V 模式（image_with_roles / image_urls + audio_urls）
      // 无音频 → I2V 模式（first_frame_image / last_frame_image）
      const hasAudio = options?.audioUrls && options.audioUrls.length > 0;
      if (hasAudio) {
        // R2V 模式：image_with_roles 同样支持 first_frame / last_frame 角色
        if (options?.imageRoles && options.imageRoles.length > 0) {
          requestBody.image_with_roles = options.imageRoles;
        } else if (referenceImageUrls.length > 0) {
          requestBody.image_urls = referenceImageUrls.slice(0, 9);
        }
        requestBody.audio_urls = options.audioUrls!.slice(0, 3);
        if (options?.imageRoles && options.imageRoles.length > 0) {
          const firstFrame = options.imageRoles.find(r => r.role === 'first_frame');
          const lastFrame = options.imageRoles.find(r => r.role === 'last_frame');
          if (firstFrame) requestBody.first_frame_image = firstFrame.url;
          if (lastFrame) requestBody.last_frame_image = lastFrame.url;
        } else if (referenceImageUrls.length > 0) {
          requestBody.first_frame_image = referenceImageUrls[0];
        }
      }
    } else if (options?.imageRoles && options.imageRoles.length > 0) {
      const firstFrame = options.imageRoles.find(img => img.role === 'first_frame');
      const lastFrame = options.imageRoles.find(img => img.role === 'last_frame');
      if (model.toLowerCase().includes('veo')) {
        // veo3.1: 首尾帧通过 image_urls 传递（第1张首帧、第2张尾帧）+ generation_type: frame
        requestBody.image_urls = [firstFrame?.url, lastFrame?.url].filter(Boolean);
        if (firstFrame && lastFrame) requestBody.generation_type = 'frame';
      } else if (model.toLowerCase().includes('sora')) {
        // sora-2: 不支持首尾帧，只取首帧作为参考图（最多1张）
        requestBody.image_urls = [firstFrame?.url ?? options.imageRoles[0].url];
      } else {
        // seedance / doubao / wan2.x: 使用 image_with_roles 指定首帧/尾帧
        requestBody.image_with_roles = isDoubaoSeedance
          ? options.imageRoles.map(r => ({ ...r, url: ensureCloudinaryMinHeight(r.url) }))
          : options.imageRoles;
      }
    } else if (referenceImageUrls.length > 0) {
      // sora-2 最多支持 1 张参考图
      const urls = model.toLowerCase().includes('sora')
        ? referenceImageUrls.slice(0, 1)
        : referenceImageUrls;
      requestBody.image_urls = isDoubaoSeedance
        ? urls.map(ensureCloudinaryMinHeight)
        : urls;
    }

    // Seedance 2.0 / HappyHorse 增强功能
    if (options?.videoUrls && options.videoUrls.length > 0) {
      if (isHappyHorse && options.videoUrls.length === 1) {
        requestBody.video_url = options.videoUrls[0];
      } else {
        requestBody.video_urls = options.videoUrls;
      }
    }
    // 按模型分发音频参数
    const isSeedance20 = model.includes('seedance-2') || model.includes('seedance-4') || model.includes('seedance-5');
    const isSeedance15 = (model.includes('seedance-1') || model.includes('doubao')) && !isSeedance20;
    const isWan26 = model.toLowerCase().includes('wan2.6') || model.toLowerCase().includes('wan 2.6');
    const isWan27 = model.toLowerCase().includes('wan2.7') || model.toLowerCase().includes('wan 2.7');

    if (options?.generateAudio) {
      // 让模型自动生成音频（seedance-2.0 支持 generate_audio，seedance-1-5 支持 audio）
      if (isSeedance20) requestBody.generate_audio = true;
      else if (isSeedance15) requestBody.audio = true;
    } else if (options?.audioUrls && options.audioUrls.length > 0) {
      if (isSeedance20) {
        requestBody.audio_urls = options.audioUrls.slice(0, 3);
      } else if (isWan26 || isWan27) {
        requestBody.audio_url = options.audioUrls[0];
      }
      // seedance-1-5-pro 只支持 audio: boolean（AI自动配音），不支持传入自定义音频
      // sora-2 / veo3 / grok / omni-flash-ext / happyhorse：无音频参数
    }
    if (isSeedance15 && options?.audioUrls === undefined) {
      // seedance-1-5-pro 在没有指定自定义音频时可开启AI自动配音（可选）
      // requestBody.audio = true; // 如需自动配音可取消注释
    }

    console.log('=== Video Generation Request ===');
    console.log('Request Body:', JSON.stringify(requestBody, null, 2));
    console.log('================================');

    const response = await axios.post(
      `${APIMART_BASE_URL}/videos/generations`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.data[0].task_id;
  } catch (error: any) {
    console.error('Video generation API error:', error);
    console.error('Error details:', error.response?.data);
    console.error('Status:', error.response?.status);
    throw new Error(`Failed to create video generation task: ${error.response?.data?.error?.message || error.message}`);
  }
}

// 上传 base64 图片到 APIMart 获取公网 URL
export async function uploadImageToPublic(base64Image: string, apiKey?: string): Promise<string> {
  if (!apiKey) throw new Error('API key required for image upload');
  try {
    const matches = base64Image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid base64 image format');
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = mimeType.split('/')[1];

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), `image.${ext}`);

    const response = await axios.post(
      `${APIMART_BASE_URL}/uploads/images`,
      form,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    return response.data.url;
  } catch (error: any) {
    console.error('Upload image error:', error.response?.data || error.message);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
}


export async function getVideoTaskStatus(taskId: string, apiKey: string): Promise<ApiMartVideoStatusResponse> {
  try {
    const response = await axios.get(
      `${APIMART_BASE_URL}/tasks/${taskId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    console.log(`Video task ${taskId} raw response:`, JSON.stringify(response.data, null, 2));

    if (response.data.data) {
      return response.data.data;
    }

    return response.data;
  } catch (error) {
    console.error('Video task status API error:', error);
    throw new Error('Failed to get video task status');
  }
}
