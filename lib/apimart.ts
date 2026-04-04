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

    return response.data.choices[0].message.content;
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
  aspectRatio: '16:9' | '9:16' = '16:9'
): Promise<string> {
  try {
    const imageUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls
      : [referenceImageUrls];

    const requestBody: any = {
      model,
      prompt,
      size: aspectRatio,
      resolution: '2K',
      n: 1
    };

    if (imageUrls.length > 0 && imageUrls[0]) {
      requestBody.image_urls = imageUrls;
    }

    console.log('=== Image Generation Request ===');
    console.log('Model:', model);
    console.log('Request Body:', JSON.stringify(requestBody, null, 2));
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
    console.error('Error details:', error.response?.data);
    throw new Error(`Failed to create image generation task: ${error.response?.data?.error?.message || error.message}`);
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
    imageRoles?: Array<{ url: string; role: 'first_frame' | 'last_frame' }>;
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

    // Doubao Seedance 使用 size 参数，其他模型使用 aspect_ratio
    if (model.includes('doubao') || model.includes('seedance')) {
      requestBody.size = aspectRatio;
    } else {
      requestBody.aspect_ratio = aspectRatio;
    }

    // 根据模型类型应用参考图
    if (options?.imageRoles && options.imageRoles.length > 0) {
      // 使用自定义角色（首帧/尾帧）
      requestBody.image_with_roles = options.imageRoles;
    } else if (referenceImageUrls.length > 0) {
      // 所有模型都使用 image_urls
      requestBody.image_urls = referenceImageUrls;
    }

    // Seedance 2.0 增强功能
    if (options?.videoUrls && options.videoUrls.length > 0) {
      requestBody.video_urls = options.videoUrls;
    }
    if (options?.audioUrls && options.audioUrls.length > 0) {
      requestBody.audio_urls = options.audioUrls;
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

// 上传 base64 图片到 imgbb 获取公网 URL
export async function uploadImageToPublic(base64Image: string): Promise<string> {
  try {
    // 移除 base64 前缀
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

    // 使用 imgbb 免费 API (需要 API key)
    const imgbbApiKey = process.env.IMGBB_API_KEY || '8d32e7f2e9fcf21b8cf2b4f3f9c8e7f2'; // 临时测试key

    const formData = new URLSearchParams();
    formData.append('image', base64Data);

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${imgbbApiKey}`,
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (response.data.success && response.data.data.url) {
      return response.data.data.url;
    }

    throw new Error('Failed to upload image to imgbb');
  } catch (error: any) {
    console.error('Upload image error:', error);
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
