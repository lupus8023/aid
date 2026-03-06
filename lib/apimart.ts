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
  referenceImageUrls: string | string[], // 支持单个或多个参考图
  apiKey: string,
  model: string = 'gemini-3-pro-image-preview',
  aspectRatio: '16:9' | '9:16' = '16:9'
): Promise<string> {
  try {
    // 确保 referenceImageUrls 是数组格式
    const imageUrls = Array.isArray(referenceImageUrls)
      ? referenceImageUrls
      : [referenceImageUrls];

    // 根据是否有参考图片构建请求体
    const requestBody: any = {
      model,
      prompt,
      size: aspectRatio,
      resolution: '2K',
    };

    // 只有当有参考图片时才添加相关参数
    if (imageUrls.length > 0 && imageUrls[0]) {
      requestBody.image_urls = imageUrls;
      requestBody.image_weight = 0.8;
      requestBody.style_fidelity = 'high';
      requestBody.cfg_scale = 7.5;
    }

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

    // 响应格式：{ code: 200, data: [{ status: "submitted", task_id: "..." }] }
    return response.data.data[0].task_id;
  } catch (error: any) {
    console.error('Image generation API error:', error);
    console.error('Error details:', error.response?.data);
    console.error('Status:', error.response?.status);
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
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9'
): Promise<string> {
  try {
    const requestBody: any = {
      model,
      prompt,
      duration: 5,
      aspect_ratio: aspectRatio,
    };

    // 根据模型类型应用参考图
    if (referenceImageUrls.length > 0) {
      if (model.includes('doubao') || model.includes('seedance')) {
        // doubao/seedance 使用 image_with_roles 格式
        requestBody.image_with_roles = [
          { url: referenceImageUrls[0], role: 'first_frame' }
        ];
        // 如果有第二张图，作为尾帧
        if (referenceImageUrls.length > 1) {
          requestBody.image_with_roles.push(
            { url: referenceImageUrls[1], role: 'last_frame' }
          );
        }
      } else {
        // veo3/sora 等使用 image_urls (数组)
        requestBody.image_urls = referenceImageUrls;
      }
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
