import { createVideoTask, getVideoTaskStatus } from './apimart';
import { Storyboard } from '@/types';
import { buildVideoContinuityRules } from './promptArchitecture';

export function buildStoryboardVideoPrompt(
  storyboard: Storyboard,
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
): string {
  const basePrompt = storyboard.videoPrompt
    ? storyboard.videoPrompt
    : storyboard.prompt.replace(/\[([^\]]+)\]/g, '$1');
  const dialogueSection = storyboard.dialogueLines && storyboard.dialogueLines.length > 0
    ? '\n\nDIALOGUE — character must speak these exact lines with lip sync:\n' +
      storyboard.dialogueLines.map(line => `${line.character}: "${line.text}"`).join('\n')
    : '';
  const audioMapping = characterAudios.length > 0
    ? '\n' + characterAudios.map(audio => `@[${audio.character}] 使用@[${audio.audioUrl}]`).join('\n')
    : '';
  const continuityRules = firstFrameUrl
    ? `\n\nCONTINUITY — this shot continues from the previous one:\n- The action must start exactly from the state shown in the first frame. Character position, pose, clothing, and environment must match seamlessly.\n- The motion must flow naturally from the first frame into the rest of the shot, with no abrupt jumps, freezes, or stutters.\n- Character orientation and spatial relationship must remain consistent throughout the transition.\n- Avoid any visual glitch, flicker, or sudden change in lighting, color, or background between the first frame and the generated motion.\n- The camera movement style should match the previous shot (e.g., if previous was handheld, continue handheld; if locked-off, stay locked-off).`
    : '';
  return `${basePrompt}${dialogueSection}${audioMapping}${continuityRules}

${buildVideoContinuityRules(characterAudios.length > 0)}`;
}

// 为单个分镜生成视频
export async function generateStoryboardVideo(
  storyboard: Storyboard,
  apiKey: string,
  model: string = 'sora-2',
  aspectRatio: '16:9' | '9:16' = '16:9',
  audioFiles: string[] = [],
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
  generateAudio?: boolean
): Promise<string> {
  // 确保有生成的图片
  if (!storyboard.imageUrl) {
    throw new Error(`Storyboard scene ${storyboard.sceneNumber} does not have a generated image`);
  }

  // Validate imageUrl is a public http/https URL (not base64)
  if (!storyboard.imageUrl.startsWith('http://') && !storyboard.imageUrl.startsWith('https://')) {
    throw new Error(`Scene ${storyboard.sceneNumber} image is not a public URL. Please regenerate the image individually first.`);
  }

  const videoPrompt = buildStoryboardVideoPrompt(storyboard, characterAudios, firstFrameUrl);


  console.log(`Creating video task for storyboard scene ${storyboard.sceneNumber}`);
  console.log(`Mode: Image-to-Video`);
  console.log(`Video prompt: ${videoPrompt}`);
  console.log(`Reference image: ${storyboard.imageUrl}`);
  console.log(`Using model: ${model}`);

  const isGrokImagine = model.toLowerCase().includes('grok-imagine');

  // firstFrameUrl = last frame of previous shot's video (Cloudinary so_last)
  const imageRoles = firstFrameUrl
    ? [{ url: firstFrameUrl, role: 'first_frame' as const }, { url: storyboard.imageUrl!, role: 'last_frame' as const }]
    : undefined;

  const taskId = await createVideoTask(
    videoPrompt,
    imageRoles ? [] : [storyboard.imageUrl!],
    apiKey,
    model,
    aspectRatio,
    {
      duration: storyboard.videoDuration,
      quality: isGrokImagine ? '480p' : undefined,
      // Don't pass audio when using firstFrame/lastFrame continuity mode (API limitation)
      audioUrls: firstFrameUrl ? [] : audioFiles,
      generateAudio: !firstFrameUrl && generateAudio,
      imageRoles
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
