import { createImageTask, getTaskStatus } from './apimart';
import { Storyboard, Character, ObjectItem, VisualStyle } from '@/types';
import { buildImageCaptureContract, buildMediumLock } from './promptArchitecture';

// 为单个分镜生成图片
export async function generateStoryboardImage(
  storyboard: Storyboard,
  characters: Character[],
  apiKey: string,
  objects: ObjectItem[] = [],
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
  imageModel?: string,
  globalCostumeImages: Record<string, string> = {},
  globalSceneImage?: string,
  preUploadedReferences?: string[],
  preUploadedReferenceLabels: string[] = [],
  visualStyle?: VisualStyle
): Promise<string> {
  // 找到该分镜中出现的角色
  const sceneCharacters = characters.filter(c =>
    storyboard.characters.includes(c.name)
  );

  // 找到该分镜中出现的物体(如果有)
  const sceneObjects = objects.filter(o =>
    storyboard.objects?.includes(o.name)
  );
  const exactCastContract = sceneCharacters.length
    ? `EXACT CAST (${sceneCharacters.length} total): ${sceneCharacters.map(character => `${character.name} — exactly one visible instance`).join('; ')}. Show no other person, creature, background extra, reflection-double, duplicate, twin, clone, or alternate pose. A character sheet may show several views of one identity; use it only to identify that one character and instantiate the character once.`
    : 'EXACT CAST (0 total): no person or character visible. Do not add background extras, silhouettes, reflections, portraits, or crowds.';

  console.log(`Scene ${storyboard.sceneNumber} debug info:`);
  console.log('- Storyboard objects field:', storyboard.objects);
  console.log('- Available objects:', objects.map(o => o.name));
  console.log('- Matched scene objects:', sceneObjects.map(o => o.name));
  console.log('- Pre-uploaded references:', preUploadedReferences?.length || 0);

  // 如果提供了预上传的参考图（用于九宫格生成），直接使用
  if (preUploadedReferences && preUploadedReferences.length > 0) {
    console.log('Using pre-uploaded references for grid generation');

    const cleanPrompt = storyboard.prompt.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]/g, '$1');

    // 收集有参考图和无参考图的物体描述
    const objectsWithRef: ObjectItem[] = [];
    const objectsWithoutRef: ObjectItem[] = [];

    sceneObjects.forEach((obj) => {
      const img = obj.imageUrl || obj.imageBase64;
      if (img) {
        objectsWithRef.push(obj);
      } else {
        objectsWithoutRef.push(obj);
      }
    });

    // Grid callers provide labels in the exact same order as the images. Using
    // those labels avoids reference number drift when an entity has no image.
    const referenceDescriptions = preUploadedReferences.map((_, index) => {
      const label = preUploadedReferenceLabels[index];
      return `Reference image ${index + 1}: ${label || `uploaded visual reference ${index + 1}`}. Match this reference exactly.`;
    });

    // 没有参考图的物体
    objectsWithoutRef.forEach((obj) => {
      referenceDescriptions.push(
        `Object requirement: "${obj.name}" - ${obj.description}. Generate this object according to the description, maintaining consistent appearance across all shots.`
      );
    });

    // Grid-specific scene content must lead the request. If APIMart's practical
    // prompt limit is reached, the generic style/reference tail may be trimmed,
    // but the nine distinct panels and batch identity must always survive.
    const isStructuredGridPrompt = cleanPrompt.includes('UNIQUE STORYBOARD BATCH:')
      && cleanPrompt.includes('GRID CAPTURE PHYSICS (authoritative)');
    const supplementalObjectRules = objectsWithoutRef.map(obj =>
      `Unmapped object "${obj.name}": ${obj.description}. Keep its design identical wherever requested.`
    );
    const enhancedPrompt = isStructuredGridPrompt ? `${cleanPrompt}

${supplementalObjectRules.join('\n')}
` : `${cleanPrompt}

GRID CAST AUTHORITY: obey the separate EXACT CAST declaration inside each panel description. Never apply the batch-wide reference list as the cast of every panel. Each character sheet is identity evidence for one identity, not permission to create multiple poses or copies.

${buildMediumLock(visualStyle)}

${buildImageCaptureContract(visualStyle)}

${referenceDescriptions.join('\n')}

Strict rules: obey EXACT CAST literally; maintain exact face, hairstyle, clothing and visual style for every character. Keep object shape, color, material, texture, text/logo and all details identical. No captions, subtitles, dialogue text, speech bubbles, titles, logos, watermark, or UI. Maintain exact lighting and atmosphere from the scene reference.

`;

    // 清理 prompt 中可能导致 API 错误的特殊字符
    const cleanEnhancedPrompt = enhancedPrompt
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '');

    const finalPrompt = cleanEnhancedPrompt.length > 4000
      ? (() => {
          const truncIndex = cleanEnhancedPrompt.lastIndexOf('. ', 3900);
          const truncated = truncIndex > 0 ? cleanEnhancedPrompt.substring(0, truncIndex + 1) : cleanEnhancedPrompt.substring(0, 4000);
          console.log(`Truncated prompt length: ${truncated.length} chars`);
          return truncated;
        })()
      : cleanEnhancedPrompt;

    console.log(`Creating grid image task with ${preUploadedReferences.length} reference images`);
    console.log(`Prompt length: ${finalPrompt.length} characters`);

    const taskId = await createImageTask(
      finalPrompt,
      preUploadedReferences,
      apiKey,
      imageModel || 'doubao-seedream-5-0-lite',
      aspectRatio,
      // A 2K mother contact sheet leaves each of the nine cells at roughly
      // 650×360. Generate the grid at 4K, then the split route stores a
      // compressed mother and serves compact native-detail cells to H3.
      '4K',
    );

    console.log(`Image task created successfully, task ID: ${taskId}`);
    return taskId;
  }

  // 单个分镜生成的正常流程
  // 收集所有角色的参考图片 — 优先使用全局定妆图
  const characterImages = sceneCharacters
    .map(char => globalCostumeImages[char.name] || char.imageUrl || char.imageBase64)
    .filter(img => img);

  // 场景参考图
  const sceneImages_list = globalSceneImage ? [globalSceneImage] : [];

  // 收集所有物体的参考图片，同时记录哪些物体有参考图
  const objectImages: string[] = [];
  const objectsWithRef: ObjectItem[] = [];
  const objectsWithoutRef: ObjectItem[] = [];

  sceneObjects.forEach((obj) => {
    const img = obj.imageUrl || obj.imageBase64;
    if (img) {
      objectImages.push(img);
      objectsWithRef.push(obj);
    } else {
      objectsWithoutRef.push(obj);
    }
  });

  // 合并所有参考图片：定妆图 + 场景图 + 有参考图的物体图
  const referenceImages = [...characterImages, ...sceneImages_list, ...objectImages];

  // 检查是否有任何角色或物体（无论是否有参考图）
  const hasAnyContent = sceneCharacters.length > 0 || sceneObjects.length > 0;

  // 如果没有任何角色和物体，使用纯文生图
  if (!hasAnyContent) {
    console.log(`Scene ${storyboard.sceneNumber} has no characters or objects, using text-to-image generation`);

    // 纯文生图也要清理 brackets
    const cleanPrompt = `${buildMediumLock(visualStyle)}\n\n${buildImageCaptureContract(visualStyle)}\n\n${storyboard.prompt.replace(/\[([^\]]+)\]/g, '$1')}`;

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
      `Reference image ${imgIndex}: "${char.name}" - ${usingCostume ? 'CHARACTER REFERENCE. Maintain consistent appearance, hairstyle, clothing, and visual style from this reference.' : `${char.description}. Match the character's appearance and clothing style from this reference image.`}`
    );
    imgIndex++;
  });

  if (globalSceneImage) {
    referenceDescriptions.push(
      `Reference image ${imgIndex}: SCENE REFERENCE - Use this as the environment/background style. Match the lighting, atmosphere, and setting exactly.`
    );
    imgIndex++;
  }

  // 有参考图的物体：添加 Reference image X 引用
  objectsWithRef.forEach((obj) => {
    referenceDescriptions.push(
      `Reference image ${imgIndex}: "${obj.name}" - ${obj.description}. MUST reproduce exact shape, color, material, texture, text, and all details from this reference image.`
    );
    imgIndex++;
  });

  // 没有参考图的物体：直接添加描述，不引用 Reference image
  objectsWithoutRef.forEach((obj) => {
    referenceDescriptions.push(
      `Object requirement: "${obj.name}" - ${obj.description}. Generate this object according to the description, maintaining consistent appearance across all shots.`
    );
  });

  const enhancedPrompt = `${exactCastContract}

${buildMediumLock(visualStyle)}

${buildImageCaptureContract(visualStyle)}

${referenceDescriptions.join('\n')}

${cleanedScenePrompt}

Strict rules: obey EXACT CAST literally; maintain exact face, hairstyle, clothing and visual style for every character. Keep object shape, color, material, texture, text/logo and all details identical. No captions, subtitles, dialogue text, speech bubbles, titles, logos, watermark, or UI. Maintain exact lighting and atmosphere from the scene reference.

`;

  // 清理 prompt 中可能导致 API 错误的特殊字符
  const cleanEnhancedPrompt = enhancedPrompt
    .replace(/[\x00-\x1F\x7F]/g, '') // 移除控制字符
    .replace(/[\u200B-\u200D\uFEFF]/g, ''); // 移除零宽字符

  // 创建图像生成任务
  console.log(`Creating image task for storyboard scene ${storyboard.sceneNumber}`);
  console.log(`Characters: ${sceneCharacters.map(c => c.name).join(', ')}`);
  console.log(`Objects: ${sceneObjects.map(o => o.name).join(', ')}`);
  console.log(`Reference images count: ${referenceImages.length}`);
  console.log(`Prompt length: ${cleanEnhancedPrompt.length} characters`);

  // 检查Prompt长度并警告/截断
  const finalPrompt = cleanEnhancedPrompt.length > 4000
    ? (() => {
        const truncIndex = cleanEnhancedPrompt.lastIndexOf('. ', 3900);
        const truncated = truncIndex > 0 ? cleanEnhancedPrompt.substring(0, truncIndex + 1) : cleanEnhancedPrompt.substring(0, 4000);
        console.log(`Truncated prompt length: ${truncated.length} chars`);
        return truncated;
      })()
    : cleanEnhancedPrompt;

  if (finalPrompt.length > 5000) {
    console.error(`❌ ERROR: Prompt is still too long (${finalPrompt.length} chars) after truncation. Generation may fail.`);
  }

  const taskId = await createImageTask(
    finalPrompt,
    referenceImages.filter((img): img is string => typeof img === 'string'),
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
