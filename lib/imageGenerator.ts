import { createImageTask, getTaskStatus } from './apimart';
import { Storyboard, Character, ObjectItem } from '@/types';

// 为单个分镜生成图片
export async function generateStoryboardImage(
  storyboard: Storyboard,
  characters: Character[],
  apiKey: string,
  objects: ObjectItem[] = [],
  aspectRatio: '16:9' | '9:16' = '16:9',
  imageModel?: string,
  globalCostumeImages: Record<string, string> = {},
  globalSceneImage?: string
): Promise<string> {
  // 找到该分镜中出现的角色
  const sceneCharacters = characters.filter(c =>
    storyboard.characters.includes(c.name)
  );

  // 找到该分镜中出现的物体(如果有)
  const sceneObjects = objects.filter(o =>
    storyboard.objects?.includes(o.name)
  );

  console.log(`Scene ${storyboard.sceneNumber} debug info:`);
  console.log('- Storyboard objects field:', storyboard.objects);
  console.log('- Available objects:', objects.map(o => o.name));
  console.log('- Matched scene objects:', sceneObjects.map(o => o.name));

  // 收集所有角色的参考图片 — 优先使用全局定妆图
  const characterImages = sceneCharacters
    .map(char => globalCostumeImages[char.name] || char.imageBase64 || char.imageUrl)
    .filter(img => img);

  // 场景参考图
  const sceneImages = globalSceneImage ? [globalSceneImage] : [];

  // 收集所有物体的参考图片
  const objectImages = sceneObjects
    .map(obj => obj.imageBase64 || obj.imageUrl)
    .filter(img => img);

  // 合并所有参考图片：定妆图 + 场景图 + 物体图
  const referenceImages = [...characterImages, ...sceneImages, ...objectImages];

  // 如果既没有角色也没有物体，使用纯文生图
  if (referenceImages.length === 0) {
    console.log(`Scene ${storyboard.sceneNumber} has no characters or objects, using text-to-image generation`);

    // 纯文生图也要清理 brackets
    const cleanPrompt = storyboard.prompt.replace(/\[([^\]]+)\]/g, '$1');

    const taskId = await createImageTask(
      cleanPrompt,
      [],
      apiKey,
      imageModel || 'doubao-seedream-5-0-lite',
      aspectRatio
    );

    console.log(`Image task created successfully (text-only), task ID: ${taskId}`);
    return taskId;
  }

  // 清理 prompt 中的 [brackets] 标记 — 这是给 LLM 用的约定，图像模型不认识
  let cleanedScenePrompt = storyboard.prompt;
  // 将 [Name] 替换为 Name（去掉方括号）
  cleanedScenePrompt = cleanedScenePrompt.replace(/\[([^\]]+)\]/g, '$1');

  // 构建清晰的参考图说明 — 让模型明确知道每张参考图对应什么
  const referenceDescriptions: string[] = [];
  let imgIndex = 1;

  sceneCharacters.forEach((char) => {
    const usingCostume = !!globalCostumeImages[char.name];
    referenceDescriptions.push(
      `Reference image ${imgIndex}: "${char.name}" - ${usingCostume ? 'COSTUME REFERENCE (use this exact costume/appearance)' : char.description}. MUST copy exact face, hair, skin tone, body type, and clothing from this reference image.`
    );
    imgIndex++;
  });

  if (globalSceneImage) {
    referenceDescriptions.push(
      `Reference image ${imgIndex}: SCENE REFERENCE - Use this as the environment/background style. Match the lighting, atmosphere, and setting exactly.`
    );
    imgIndex++;
  }

  sceneObjects.forEach((obj) => {
    referenceDescriptions.push(
      `Reference image ${imgIndex}: "${obj.name}" - ${obj.description}. MUST reproduce exact shape, color, material, texture, text, and all details from this reference image.`
    );
    imgIndex++;
  });

  const enhancedPrompt = `IMAGE-TO-IMAGE GENERATION: Use the provided reference images to generate the scene below. All characters and objects MUST match their reference images exactly.

${referenceDescriptions.join('\n')}

SCENE: ${cleanedScenePrompt}

CRITICAL RULES:
- Characters: Copy exact appearance from reference images (face, hair, body, clothing). DO NOT change or reinterpret.
- Objects: Copy exact appearance from reference images (shape, color, texture, details). DO NOT change or reinterpret.
- Only adjust: pose, position, expression, camera angle, lighting.
- DO NOT add characters/objects not in references.`;


  // 创建图像生成任务
  console.log(`Creating image task for storyboard scene ${storyboard.sceneNumber}`);
  console.log(`Characters: ${sceneCharacters.map(c => c.name).join(', ')}`);
  console.log(`Reference images count: ${referenceImages.length}`);
  console.log(`Enhanced prompt length: ${enhancedPrompt.length} characters`);

  // 检查Prompt长度并警告
  if (enhancedPrompt.length > 3000) {
    console.warn(`⚠️ WARNING: Prompt is very long (${enhancedPrompt.length} chars). This may cause issues.`);
  }
  if (enhancedPrompt.length > 5000) {
    console.error(`❌ ERROR: Prompt is too long (${enhancedPrompt.length} chars). Generation may fail.`);
  }

  const taskId = await createImageTask(
    enhancedPrompt,
    referenceImages,
    apiKey,
    imageModel || 'doubao-seedream-5-0-lite',
    aspectRatio
  );

  console.log(`Image task created successfully, task ID: ${taskId}`);
  return taskId;
}

// 轮询检查任务状态，直到完成
export async function waitForImageGeneration(
  taskId: string,
  apiKey: string,
  maxAttempts: number = 90,
  intervalMs: number = 3000
): Promise<string> {
  console.log(`Starting to poll task ${taskId}, max attempts: ${maxAttempts}, interval: ${intervalMs}ms`);

  for (let i = 0; i < maxAttempts; i++) {
    const status = await getTaskStatus(taskId, apiKey);
    console.log(`Attempt ${i + 1}/${maxAttempts} - Task ${taskId} status:`, status.status);

    if (status.status === 'completed' && status.result?.images?.[0]?.url) {
      const imageUrl = status.result.images[0].url;
      const finalUrl = Array.isArray(imageUrl) ? imageUrl[0] : imageUrl;
      console.log(`Task ${taskId} completed successfully, image URL:`, finalUrl);
      return finalUrl;
    }

    if (status.status === 'failed') {
      console.error(`Task ${taskId} failed:`, status);
      throw new Error('Image generation failed');
    }

    // 等待后再次检查
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.error(`Task ${taskId} timeout after ${maxAttempts} attempts (${maxAttempts * intervalMs / 1000} seconds)`);
  throw new Error('Image generation timeout');
}
