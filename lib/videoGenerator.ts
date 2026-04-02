import { createVideoTask, getVideoTaskStatus } from './apimart';
import { Storyboard } from '@/types';

// 为单个分镜生成视频
export async function generateStoryboardVideo(
  storyboard: Storyboard,
  apiKey: string,
  model: string = 'sora-2',
  aspectRatio: '16:9' | '9:16' = '16:9',
  audioFiles: string[] = []
): Promise<string> {
  // 确保有生成的图片
  if (!storyboard.imageUrl) {
    throw new Error(`Storyboard scene ${storyboard.sceneNumber} does not have a generated image`);
  }

  // 图生视频模式：prompt 聚焦运动和镜头，视觉信息已在输入图片中
  // 从场景 prompt 中去掉 [brackets]（那是给 LLM 用的标记）
  const cleanScenePrompt = storyboard.prompt.replace(/\[([^\]]+)\]/g, '$1');

  const videoPrompt = `Scene: ${cleanScenePrompt}

Visual consistency: Keep all characters, objects, and scene elements exactly as shown in the image. No changes to appearance, clothing, or environment throughout the video.

Motion: Animate the scene naturally to match the described action. Smooth, realistic movement with appropriate pacing.

IMPORTANT: Do not add dialogue subtitles or speech captions. Any dialogue mentioned in the scene description is for context only and should not appear as subtitles.`;


  console.log(`Creating video task for storyboard scene ${storyboard.sceneNumber}`);
  console.log(`Mode: Image-to-Video`);
  console.log(`Video prompt: ${videoPrompt}`);
  console.log(`Reference image: ${storyboard.imageUrl}`);
  console.log(`Using model: ${model}`);

  // 创建视频生成任务，使用生成的图片作为参考（图生视频模式）
  const taskId = await createVideoTask(
    videoPrompt,
    [storyboard.imageUrl], // 传递图片URL数组
    apiKey,
    model,
    aspectRatio,
    {
      audioUrls: audioFiles
    }
  );

  console.log(`Video task created successfully, task ID: ${taskId}`);
  return taskId;
}

// 轮询检查视频任务状态，直到完成
export async function waitForVideoGeneration(
  taskId: string,
  apiKey: string,
  maxAttempts: number = 120, // 视频生成通常需要更长时间
  intervalMs: number = 5000 // 每5秒检查一次
): Promise<string> {
  console.log(`Starting to poll video task ${taskId}, max attempts: ${maxAttempts}, interval: ${intervalMs}ms`);

  for (let i = 0; i < maxAttempts; i++) {
    const status = await getVideoTaskStatus(taskId, apiKey);
    console.log(`Attempt ${i + 1}/${maxAttempts} - Video task ${taskId} status:`, status.status);

    if (status.status === 'completed' && status.result?.videos?.[0]?.url) {
      console.log(`Video task ${taskId} completed successfully, video URL:`, status.result.videos[0].url);
      return status.result.videos[0].url;
    }

    if (status.status === 'failed') {
      console.error(`Video task ${taskId} failed:`, status);
      throw new Error('Video generation failed');
    }

    // 等待后再次检查
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.error(`Video task ${taskId} timeout after ${maxAttempts} attempts (${maxAttempts * intervalMs / 1000} seconds)`);
  throw new Error('Video generation timeout');
}
