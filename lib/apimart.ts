import axios from 'axios';
import { assertProviderAccepted, chatInputContent, extractProviderText, ProviderModelRefusalError, providerPayloadSummary, providerResponseMetadata, type ProviderTextResult } from './pipeline/providerPayload';
import type { ApiMartChatResponse, ApiMartImageTaskResponse, ApiMartImageStatusResponse, ApiMartVideoStatusResponse } from '@/types';
import { providerHttpsAgent } from './publicDns';
import { isRequestDefinitelyNotSent, ProviderRequestNotSentError } from './providerConnection';
import {
  buildImageGenerationPayload,
  extractImageTaskId,
  getImageModelCapabilities,
  type ImageGenerationAspectRatio,
  type ImageResolutionOverride,
} from './imageModels';
import {
  MIDJOURNEY_TASK_PREFIX,
  buildMidjourneyImaginePayload,
  midjourneyGenerationPath,
  midjourneyEditPayload,
  unwrapMidjourneyTaskId,
  type MidjourneyReferenceMode,
  type MidjourneyTaskMode,
  type MidjourneyReferenceOptions,
} from './midjourney';
import type { CapturePreset, VisualStyle } from '@/types';

const APIMART_BASE_URL = 'https://api.apimart.ai/v1';
let preferSystemNetworkStack = false;

function redactProviderText(value: unknown): string {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .slice(0, 600);
}

export function apimartErrorSummary(error: any): { code?: string; status?: number; message: string } {
  return {
    code: typeof error?.code === 'string' ? error.code : undefined,
    status: Number.isFinite(Number(error?.response?.status)) ? Number(error.response.status) : undefined,
    message: redactProviderText(error?.response?.data?.error?.message || error?.message || 'Unknown APIMart error'),
  };
}

// 聊天 API - 用于分析故事
export async function chatCompletion(prompt: string, apiKey: string, model: string = 'gpt-4o', timeoutMs = 120000, maxTokens = 16000, imageUrls: string[] = []): Promise<string> {
  return (await chatCompletionResult(prompt, apiKey, model, timeoutMs, maxTokens, imageUrls)).text;
}

export async function chatCompletionResult(prompt: string, apiKey: string, model = 'gpt-4o', timeoutMs = 120000, maxTokens = 16000, imageUrls: string[] = [], singleAttempt = false): Promise<ProviderTextResult> {
  try {
    const body = {
      model,
      stream: false,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: chatInputContent(prompt, imageUrls) }],
    };
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    const httpsAgent = preferSystemNetworkStack ? undefined : providerHttpsAgent();
    let response;
    try {
      response = await axios.post<ApiMartChatResponse>(
        `${APIMART_BASE_URL}/chat/completions`,
        body,
        { headers, httpsAgent, timeout: timeoutMs },
      );
    } catch (error: any) {
      const connectionFailure = !error?.response && /ECONNRESET|ENOTFOUND|EAI_AGAIN|ERR_TLS_CERT_ALTNAME_INVALID|secure TLS connection|Hostname\/IP does not match/i.test(
        `${error?.code || ''} ${error?.message || ''}`,
      );
      if (singleAttempt || !httpsAgent || !connectionFailure) throw error;
      preferSystemNetworkStack = true;
      console.warn('[apimart] public-DNS transport failed before response; retrying through the system network stack');
      response = await axios.post<ApiMartChatResponse>(
        `${APIMART_BASE_URL}/chat/completions`,
        body,
        { headers, timeout: timeoutMs },
      );
    }

    // Handle SSE format response (": PING\n\n{...json...}")
    let rawData = response.data as any;
    if (typeof rawData === 'string') {
      const jsonMatch = rawData.match(/\{[\s\S]*\}/);
      if (jsonMatch) rawData = JSON.parse(jsonMatch[0]);
    }

    const metadata = providerResponseMetadata(rawData, { provider: 'apimart', endpoint: 'chat/completions', model, maxOutputTokens: maxTokens });
    assertProviderAccepted(rawData, metadata);
    const content = extractProviderText(rawData);
    if (!content) {
      throw new Error(`Unexpected API response format: ${providerPayloadSummary(rawData)}`);
    }
    console.log(`Chat API response received: model=${model}, contentLength=${content.length}`);
    return { text: content, metadata };
  } catch (error: any) {
    if (error instanceof ProviderModelRefusalError) throw error;
    if (error?.response?.data) assertProviderAccepted(error.response.data, { provider: 'apimart', endpoint: 'chat/completions', model, maxOutputTokens: maxTokens, status: String(error.response.status) });
    const summary = apimartErrorSummary(error);
    // Never log the Axios error/config object: it contains the Authorization
    // header and full prompt body. Keep operational diagnostics credential-free.
    console.error('Chat API error:', summary);
    throw new Error(`Failed to call chat API: ${summary.message}`);
  }
}

// 图像生成 API - 创建任务
export async function createImageTask(
  prompt: string,
  referenceImageUrls: string | string[],
  apiKey: string,
  model: string = 'seedream-5-0-pro',
  aspectRatio: ImageGenerationAspectRatio = '16:9',
  resolutionOverride?: ImageResolutionOverride,
): Promise<string> {
  try {
    const allRawUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls
      : [referenceImageUrls];
    const capabilities = getImageModelCapabilities(model);
    const validRawUrls = allRawUrls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
    if (validRawUrls.length > capabilities.maxReferenceImages) {
      throw new Error(`${capabilities.label} supports up to ${capabilities.maxReferenceImages} references; all ${validRawUrls.length} references were retained and generation was not submitted.`);
    }
    const rawUrls = validRawUrls;

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
      } catch {
        throw new Error(`参考图 ${i + 1}/${rawUrls.length} 上传失败；未提交生成，未跳过图片或改变参考编号`);
      }
    }

    const { body: requestBody, extraHeaders } = buildImageGenerationPayload({
      model,
      prompt,
      aspectRatio,
      imageUrls,
      resolutionOverride,
    });

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

    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await axios.post(
          `${APIMART_BASE_URL}/images/generations`, requestBody,
          {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extraHeaders },
            timeout: 45000,
            // Do not replay a POST after a redirect may already have accepted it.
            maxRedirects: 0,
            httpsAgent: attempt === 1 ? providerHttpsAgent() : undefined,
          },
        );
        break;
      } catch (error) {
        if (!isRequestDefinitelyNotSent(error)) throw error;
        if (attempt === 2) throw new ProviderRequestNotSentError(apimartErrorSummary(error).message);
        console.warn('[apimart] image connection failed before submission; reconnecting', { attempt: attempt + 1 });
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    if (!response) throw new Error('Image task submission returned no response');

    const taskId = extractImageTaskId(response.data);
    if (!taskId) throw new Error(`APIMart response did not include an image task ID: ${JSON.stringify(response.data)}`);
    return taskId;
  } catch (error: any) {
    const summary = apimartErrorSummary(error);
    console.error('Image generation API error:', summary);
    const message = `Failed to create image generation task: ${summary.message}`;
    if (isRequestDefinitelyNotSent(error)) throw new ProviderRequestNotSentError(message);
    throw new Error(message);
  }
}

export interface MidjourneyImageStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  imageUrls: string[];
  gridImageUrl?: string;
  error?: string;
}

export async function createMidjourneyImageTask(
  prompt: string,
  referenceImageUrls: string[],
  apiKey: string,
  aspectRatio: ImageGenerationAspectRatio,
  referenceMode: MidjourneyReferenceMode = 'image',
  visualStyle?: VisualStyle,
  capturePreset?: CapturePreset,
  taskMode?: MidjourneyTaskMode,
  hasPeople?: boolean,
  personalizationProfile?: string,
  references: MidjourneyReferenceOptions = {},
): Promise<string> {
  try {
    const sourceImages = [...new Set(referenceImageUrls.filter(url => typeof url === 'string' && url.trim()))];
    if (sourceImages.length > 4) throw new Error('MJ 最多4张内容参考，不能静默丢弃参考图');
    const imageUrls = await Promise.all(sourceImages.map(async sourceImage => (
      sourceImage.startsWith('data:') ? await uploadImageToPublic(sourceImage, apiKey) : sourceImage
    )));
    const body = buildMidjourneyImaginePayload({
      prompt,
      aspectRatio,
      imageUrls,
      referenceMode,
      visualStyle,
      capturePreset,
      taskMode,
      hasPeople,
      personalizationProfile,
      references,
    });
    const hasContentReferences = Array.isArray(body.image_urls) && body.image_urls.length > 0;
    const endpoint = midjourneyGenerationPath(taskMode, hasContentReferences, String(body.version), references.characterReferenceUrl ? 'character' : referenceMode);
    const submittedBody = endpoint.endsWith('/edits') ? midjourneyEditPayload(body) : body;
    const response = await axios.post(
      `${APIMART_BASE_URL}${endpoint}`,
      submittedBody,
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );
    const taskId = extractImageTaskId(response.data);
    if (!taskId) throw new Error(`APIMart response did not include a Midjourney task ID: ${JSON.stringify(response.data)}`);
    console.log('[midjourney] image task created', {
      operation: endpoint.endsWith('/edits') ? 'edits' : 'imagine',
      taskId,
      promptLength: String(submittedBody.prompt || '').length,
      parameterKeys: Object.keys(submittedBody).sort(),
      referenceMode: body.cref ? 'cref' : String(body.extra || '').includes('--oref ') ? 'oref'
        : endpoint.endsWith('/edits') ? 'edit' : hasContentReferences ? 'image' : 'none',
      referenceCount: Array.isArray(body.image_urls) ? body.image_urls.length : 0,
      styleReference: Boolean(body.sref),
    });
    return `${MIDJOURNEY_TASK_PREFIX}${taskId}`;
  } catch (error: any) {
    const summary = apimartErrorSummary(error);
    console.error('[midjourney] imagine request failed', summary);
    throw new Error(`Failed to create Midjourney image task: ${summary.message}`);
  }
}

export async function getMidjourneyImageStatus(taskId: string, apiKey: string): Promise<MidjourneyImageStatus> {
  const providerTaskId = unwrapMidjourneyTaskId(taskId);
  try {
    const response = await axios.get(
      `${APIMART_BASE_URL}/midjourney/${providerTaskId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 20_000,
      },
    );
    const raw = response.data?.data || response.data || {};
    const providerStatus = String(raw.status || '').toUpperCase();
    const status: MidjourneyImageStatus['status'] = providerStatus === 'SUCCESS'
      ? 'completed'
      : providerStatus === 'FAILURE'
        ? 'failed'
        : providerStatus === 'IN_PROGRESS'
          ? 'processing'
          : 'pending';
    const imageUrls = (Array.isArray(raw.image_urls) ? raw.image_urls : [])
      .filter((url: unknown): url is string => typeof url === 'string' && /^https?:\/\//i.test(url));
    return {
      taskId,
      status,
      imageUrls,
      gridImageUrl: typeof raw.grid_image_url === 'string' ? raw.grid_image_url : undefined,
      error: status === 'failed' ? String(raw.fail_reason || raw.error || 'Midjourney generation failed') : undefined,
    };
  } catch (error: any) {
    const summary = apimartErrorSummary(error);
    console.error('[midjourney] task query failed', { taskId: providerTaskId, ...summary });
    throw new Error(`Failed to get Midjourney task status: ${summary.message}`);
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
