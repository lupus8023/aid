import { getMidjourneyImageStatus, getTaskStatus } from './apimart';
import { createProviderImageTask } from './imageTaskProvider';
import type { ComfyUIClientSettings } from './comfyui';
import { Storyboard, Character, ObjectItem, VisualStyle, CapturePreset } from '@/types';
import { buildImageCaptureContract, buildMediumLock } from './promptArchitecture';
import { buildImageCapturePresetContract } from './capturePresets';
import { buildGptImage2PhotographicContract, buildGptImage2StoryPrompt } from './gptImagePrompt';
import { getImageModelCapabilities, isComfyUIZImageTurbo, isGptImage2Model, isMidjourneyImageModel } from './imageModels';
import { isMidjourneyTask } from './midjourney';

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
  visualStyle?: VisualStyle,
  capturePreset?: CapturePreset,
  comfyui: ComfyUIClientSettings = {},
  midjourneyProfile = '',
): Promise<string> {
  const selectedImageModel = imageModel || 'seedream-5-0-pro';
  const maxReferenceImages = getImageModelCapabilities(selectedImageModel).maxReferenceImages;
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
    const effectiveReferences = preUploadedReferences.slice(0, maxReferenceImages);
    const effectiveReferenceLabels = preUploadedReferenceLabels.slice(0, effectiveReferences.length);

    const cleanPrompt = storyboard.prompt.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]/g, '$1');

    // 收集有参考图和无参考图的物体描述
    const objectsWithoutRef: ObjectItem[] = [];

    sceneObjects.forEach((obj) => {
      const img = obj.imageUrl || obj.imageBase64;
      if (!img) {
        objectsWithoutRef.push(obj);
      }
    });

    // Grid callers provide labels in the exact same order as the images. Using
    // those labels avoids reference number drift when an entity has no image.
    const referenceDescriptions = effectiveReferences.map((_, index) => {
      const label = effectiveReferenceLabels[index];
      return `Reference image ${index + 1}: ${label || `uploaded visual reference ${index + 1}`}. Use only the role named here. Preserve its role-specific identity, design, medium, or environment cues; ignore unrelated pose, background, layout and borders. For a declared object/product reference, its own markings and labels are part of the locked design, not disposable reference text.`;
    });

    // The official Z-Image-Turbo workflow is text-only. Preserve the semantic
    // identity/object constraints instead of silently deleting every visual
    // reference when the provider capability is zero.
    if (maxReferenceImages === 0) {
      sceneCharacters.forEach(character => referenceDescriptions.push(
        `Character requirement: "${character.name}" — ${character.description}. Keep one stable identity, face, body, hair and wardrobe wherever this character appears.`,
      ));
      sceneObjects.forEach(object => referenceDescriptions.push(
        `Object requirement: "${object.name}" — ${object.description}. Keep its silhouette, proportions, component layout, construction, material, finish, color, texture, markings and scale identical. Do not redesign, deform, simplify, substitute or add/remove parts.`,
      ));
    }

    // 没有参考图的物体
    objectsWithoutRef.forEach((obj) => {
      referenceDescriptions.push(
        `Object requirement: "${obj.name}" - ${obj.description}. Establish one exact design and maintain its silhouette, proportions, component layout, construction, material, finish, color, texture, markings and scale across all shots.`
      );
    });

    // Grid-specific scene content must lead the request. If APIMart's practical
    // prompt limit is reached, the generic style/reference tail may be trimmed,
    // but the nine distinct panels and batch identity must always survive.
    const isStructuredGridPrompt = cleanPrompt.includes('UNIQUE STORYBOARD BATCH:')
      && cleanPrompt.includes('GRID STYLE BIBLE (authoritative');
    const supplementalObjectRules = objectsWithoutRef.map(obj =>
      `Unmapped object "${obj.name}": ${obj.description}. Keep its design identical wherever requested.`
    );
    const referencedObjectNames = sceneObjects
      .filter(obj => effectiveReferenceLabels.some(label => label.toLowerCase().includes(obj.name.toLowerCase())))
      .map(obj => obj.name);
    const gridObjectLock = `REFERENCE OBJECT LOCK: ${referencedObjectNames.length ? `the mapped references for ${referencedObjectNames.join(', ')} are immutable product/prop designs` : 'any input mapped as an object or product is an immutable design source'}. Preserve exact silhouette, proportions, component layout, construction, material, surface finish, color, texture, seams, interfaces, intentional markings and physical scale in every panel. Change only viewpoint, placement, lighting and physically possible articulation. Never redesign, simplify, stretch, melt, substitute, or add/remove parts. Existing object labels or logos may remain only as unchanged physical design details; add no other text.`;
    const providerCaptureContract = isGptImage2Model(selectedImageModel)
      ? buildGptImage2PhotographicContract(visualStyle, capturePreset || storyboard.capturePreset)
      : `${buildMediumLock(visualStyle)}\n\n${buildImageCaptureContract(visualStyle)}\n\n${buildImageCapturePresetContract(capturePreset || storyboard.capturePreset)}`;
    const enhancedPrompt = isStructuredGridPrompt ? `${cleanPrompt}

${gridObjectLock}

REFERENCE INPUT ROLES:
${referenceDescriptions.join('\n')}

${supplementalObjectRules.join('\n')}
` : `${cleanPrompt}

GRID CAST AUTHORITY: obey the separate EXACT CAST declaration inside each panel description. Never apply the batch-wide reference list as the cast of every panel. Each character sheet is identity evidence for one identity, not permission to create multiple poses or copies.

${providerCaptureContract}

${referenceDescriptions.join('\n')}

Strict rules: obey EXACT CAST literally; maintain exact face, hairstyle, clothing and visual style for every character. ${gridObjectLock} No captions, subtitles, dialogue text, speech bubbles, titles, watermark, UI, or added readable text. Maintain exact lighting and atmosphere from the scene reference.

`;

    // 清理 prompt 中可能导致 API 错误的特殊字符
    const cleanEnhancedPrompt = enhancedPrompt
      .replace(/\r\n?/g, '\n')
      .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '');

    const promptLimit = isComfyUIZImageTurbo(selectedImageModel) ? 16000 : 4000;
    const finalPrompt = cleanEnhancedPrompt.length > promptLimit
      ? (() => {
          const truncIndex = cleanEnhancedPrompt.lastIndexOf('. ', promptLimit - 100);
          const truncated = truncIndex > 0 ? cleanEnhancedPrompt.substring(0, truncIndex + 1) : cleanEnhancedPrompt.substring(0, promptLimit);
          console.log(`Truncated prompt length: ${truncated.length} chars`);
          return truncated;
        })()
      : cleanEnhancedPrompt;

    console.log(`Creating grid image task with ${effectiveReferences.length} reference images`);
    console.log(`Prompt length: ${finalPrompt.length} characters`);

    const taskId = await createProviderImageTask(
      finalPrompt,
      effectiveReferences,
      apiKey,
      selectedImageModel,
      aspectRatio,
      // A 2K mother contact sheet leaves each of the nine cells at roughly
      // 650×360. Generate the grid at 4K, then the split route stores a
      // compressed mother and serves compact native-detail cells to H3.
      '4K',
      comfyui,
      {
        // Storyboard contact sheets use V8.2 HD with a loose image reference.
        midjourneyReferenceMode: 'image',
        midjourneyTaskMode: 'grid',
        midjourneyVisualStyle: visualStyle,
        midjourneyCapturePreset: capturePreset || storyboard.capturePreset,
        midjourneyHasPeople: sceneCharacters.length > 0,
        midjourneyProfile,
      },
    );

    console.log(`Image task created successfully, task ID: ${taskId}`);
    return taskId;
  }

  // 单个分镜生成的正常流程。先建立“图片 + 对应说明”的原子条目，
  // 再按模型上限裁剪，确保提示词中的 Reference image N 永远与实际上传一致。
  const characterReferenceEntries: Array<{ image: string; description: string; fallback: string }> = [];
  sceneCharacters.forEach(char => {
    const image = globalCostumeImages[char.name] || char.imageUrl || char.imageBase64;
    if (!image) return;
    const usingCostume = Boolean(globalCostumeImages[char.name]);
    characterReferenceEntries.push({
      image,
      description: `CHARACTER IDENTITY ONLY — "${char.name}". ${usingCostume ? 'Preserve the exact face, body proportions, hairstyle, wardrobe, accessories, and visual medium.' : `${char.description}. Preserve this character's exact face, body, hair, wardrobe, and visual medium.`} Ignore the reference pose, camera, background, layout, duplicate views, labels, and text. Instantiate this identity exactly once when required by the cast contract.`,
      fallback: `Character requirement: "${char.name}" - ${char.description}. Preserve this identity exactly once.`,
    });
  });
  const sceneReferenceEntry = globalSceneImage ? {
      image: globalSceneImage,
      description: 'ENVIRONMENT ONLY. Preserve architecture, geography, entrances, landmarks, time of day, motivated light direction, palette, atmosphere, and material language. Ignore any people, poses, framing, labels, or text in the reference.',
      fallback: 'Scene requirement: follow the environment, lighting and atmosphere described in the storyboard prompt.',
    } : undefined;
  const objectReferenceEntries: Array<{ image: string; description: string; fallback: string }> = [];
  const objectsWithoutRef: ObjectItem[] = [];

  sceneObjects.forEach((obj) => {
    const img = obj.imageUrl || obj.imageBase64;
    if (img) {
      objectReferenceEntries.push({
        image: img,
        description: `OBJECT IDENTITY ONLY — "${obj.name}". ${obj.description}. This image is the immutable design source for this object. Preserve its exact silhouette, dimensions, proportions, physical scale, component layout, construction, material, surface finish, color, texture, seams, closures, interfaces, intentional markings, wear and small identifying details. Change only viewpoint, placement, lighting and physically possible articulation required by the scene. Never redesign, simplify, stretch, melt, substitute, or add/remove parts. Ignore the reference background, layout and hands. Preserve labels or logos only when they physically belong to the object, in the same position and design; ignore all unrelated text.`,
        fallback: `Object requirement: "${obj.name}" - ${obj.description}. Preserve one immutable design: identical silhouette, proportions, component layout, material, finish, color, markings and scale; never redesign or deform it.`,
      });
    } else {
      objectsWithoutRef.push(obj);
    }
  });
  // Midjourney previously received only the first reference, which was always
  // the character bible. Even after multi-reference support, putting the
  // environment first makes its narrative location the composition anchor.
  // Referenced scene objects come next so a low provider reference limit can
  // never silently discard the product/prop that the current shot requires.
  const referenceEntries: Array<{ image: string; description: string; fallback: string }> = isMidjourneyImageModel(selectedImageModel)
    ? [...(sceneReferenceEntry ? [sceneReferenceEntry] : []), ...objectReferenceEntries, ...characterReferenceEntries]
    : [...objectReferenceEntries, ...characterReferenceEntries, ...(sceneReferenceEntry ? [sceneReferenceEntry] : [])];

  const selectedReferenceEntries = referenceEntries.slice(0, maxReferenceImages);
  const omittedReferenceEntries = referenceEntries.slice(maxReferenceImages);
  const referenceImages = selectedReferenceEntries.map(entry => entry.image);

  // 检查是否有任何角色或物体（无论是否有参考图）
  const hasAnyContent = sceneCharacters.length > 0 || sceneObjects.length > 0;

  // 如果没有任何角色和物体，仍然保留全局场景参考。旧逻辑把这里
  // 当成纯文生图，导致空镜与已经建立的故事地点完全断开。
  if (!hasAnyContent) {
    console.log(`Scene ${storyboard.sceneNumber} has no characters or objects, generating an environment story shot`);

    // 纯文生图也要清理 brackets
    const rawGoal = storyboard.prompt.replace(/\[([^\]]+)\]/g, '$1');
    const cleanPrompt = isGptImage2Model(selectedImageModel) ? buildGptImage2StoryPrompt({
      goal: rawGoal,
      action: storyboard.action,
      sceneStyle: storyboard.sceneStyle,
      shotSize: storyboard.shotSize,
      angle: storyboard.angle,
      cameraMove: storyboard.cameraMove,
      exactCast: exactCastContract,
      referenceDescriptions: globalSceneImage
        ? ['Reference image 1: ENVIRONMENT ONLY. Preserve its architecture, geography, practical light and material reality; ignore any people, pose, layout, labels and text.']
        : [],
      visualStyle,
      capturePreset: capturePreset || storyboard.capturePreset,
    }) : `IMAGE GOAL:
${rawGoal}

OUTPUT CONSTRAINTS:
One complete standalone frame. No captions, subtitles, dialogue text, speech bubbles, titles, logos, watermark, UI, or readable text. Do not add unrelated people, objects, or decorative elements.

${buildMediumLock(visualStyle)}

${buildImageCaptureContract(visualStyle)}

${buildImageCapturePresetContract(capturePreset || storyboard.capturePreset)}`;

    const taskId = await createProviderImageTask(
      cleanPrompt,
      globalSceneImage ? [globalSceneImage] : [],
      apiKey,
      selectedImageModel,
      aspectRatio,
      undefined,
      comfyui,
      {
        midjourneyReferenceMode: 'image',
        midjourneyTaskMode: 'story-shot',
        midjourneyVisualStyle: visualStyle,
        midjourneyCapturePreset: capturePreset || storyboard.capturePreset,
        midjourneyHasPeople: false,
        midjourneyProfile,
      },
    );

    console.log(`Image task created successfully (text-only), task ID: ${taskId}`);
    return taskId;
  }

  // 清理 prompt 中的 [brackets] 标记 — 这是给 LLM 用的约定，图像模型不认识
  let cleanedScenePrompt = storyboard.prompt;
  // 将 [Name] 替换为 Name（去掉方括号）
  cleanedScenePrompt = cleanedScenePrompt.replace(/\[([^\]]+)\]/g, '$1');

  // 构建清晰的参考图说明 — 让模型明确知道每张参考图对应什么
  const referenceDescriptions = selectedReferenceEntries.map((entry, index) =>
    `Reference image ${index + 1}: ${entry.description}`
  );
  omittedReferenceEntries.forEach(entry => referenceDescriptions.push(entry.fallback));

  // 没有参考图的物体：直接添加描述，不引用 Reference image
  objectsWithoutRef.forEach((obj) => {
    referenceDescriptions.push(
      `Object requirement: "${obj.name}" - ${obj.description}. Establish one exact design and maintain its silhouette, proportions, component layout, construction, material, finish, color, texture, markings and scale across all shots.`
    );
  });

  const enhancedPrompt = isGptImage2Model(selectedImageModel) ? buildGptImage2StoryPrompt({
    goal: cleanedScenePrompt,
    action: storyboard.action,
    sceneStyle: storyboard.sceneStyle,
    shotSize: storyboard.shotSize,
    angle: storyboard.angle,
    cameraMove: storyboard.cameraMove,
    exactCast: exactCastContract,
    referenceDescriptions,
    visualStyle,
    capturePreset: capturePreset || storyboard.capturePreset,
  }) : `IMAGE GOAL:
${cleanedScenePrompt}
Shot narrative: ${storyboard.description || storyboard.action || cleanedScenePrompt}.
Physical action: ${storyboard.action || storyboard.description || cleanedScenePrompt}.
Shot design: ${[storyboard.shotSize, storyboard.angle, storyboard.cameraMove].filter(Boolean).join(', ') || 'story-motivated cinematic composition'}.
Environment and lighting: ${storyboard.sceneStyle || 'the story location described above, with readable foreground, midground and background geography'}.

OUTPUT CONSTRAINTS:
${exactCastContract}
One complete standalone frame. No captions, subtitles, dialogue text, speech bubbles, titles, logos, watermark, UI, or readable text. Do not add unrelated people, objects, scenery, or decorative elements.

REFERENCE JOBS — each input has one job only; never blend their backgrounds, poses, or layouts:
${referenceDescriptions.join('\n')}

${buildMediumLock(visualStyle)}

${buildImageCaptureContract(visualStyle)}

${buildImageCapturePresetContract(capturePreset || storyboard.capturePreset)}

PRESERVE INVARIANTS:
Obey EXACT CAST literally. Maintain exact face, body proportions, hairstyle, clothing, accessories, and visual medium for every character. Treat each referenced object or product as an immutable design source: preserve its silhouette, dimensions, proportions, component layout, construction, material, surface finish, color, texture, seams, interfaces, intentional markings and physical scale. Change only viewpoint, placement, lighting and physically possible articulation; never redesign, simplify, stretch, melt, substitute or add/remove parts. A label or logo physically belonging to that object stays in the same position and design; add no unrelated text. Preserve the scene reference's architecture, geography, motivated light, atmosphere, and material language while allowing the requested camera viewpoint. Change only the action, composition, and viewpoint requested in IMAGE GOAL.

`;

  // 清理 prompt 中可能导致 API 错误的特殊字符
  const cleanEnhancedPrompt = enhancedPrompt
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '') // 保留结构换行，仅移除其他控制字符
    .replace(/[\u200B-\u200D\uFEFF]/g, ''); // 移除零宽字符

  // 创建图像生成任务
  console.log(`Creating image task for storyboard scene ${storyboard.sceneNumber}`);
  console.log(`Characters: ${sceneCharacters.map(c => c.name).join(', ')}`);
  console.log(`Objects: ${sceneObjects.map(o => o.name).join(', ')}`);
  console.log(`Reference images count: ${referenceImages.length}`);
  console.log(`Prompt length: ${cleanEnhancedPrompt.length} characters`);

  // 检查Prompt长度并警告/截断
  const promptLimit = isComfyUIZImageTurbo(selectedImageModel) ? 16000 : 4000;
  const finalPrompt = cleanEnhancedPrompt.length > promptLimit
    ? (() => {
        const truncIndex = cleanEnhancedPrompt.lastIndexOf('. ', promptLimit - 100);
        const truncated = truncIndex > 0 ? cleanEnhancedPrompt.substring(0, truncIndex + 1) : cleanEnhancedPrompt.substring(0, promptLimit);
        console.log(`Truncated prompt length: ${truncated.length} chars`);
        return truncated;
      })()
    : cleanEnhancedPrompt;

  if (!isComfyUIZImageTurbo(selectedImageModel) && finalPrompt.length > 5000) {
    console.error(`❌ ERROR: Prompt is still too long (${finalPrompt.length} chars) after truncation. Generation may fail.`);
  }

  const taskId = await createProviderImageTask(
    finalPrompt,
    referenceImages.filter((img): img is string => typeof img === 'string'),
    apiKey,
    selectedImageModel,
    aspectRatio,
    undefined,
    comfyui,
    {
      midjourneyReferenceMode: globalSceneImage ? 'image' : sceneCharacters.length === 1 && referenceImages.length > 0 ? 'character' : 'image',
      midjourneyTaskMode: 'story-shot',
      midjourneyVisualStyle: visualStyle,
      midjourneyCapturePreset: capturePreset || storyboard.capturePreset,
      midjourneyHasPeople: sceneCharacters.length > 0,
      midjourneyProfile,
    },
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
    if (isMidjourneyTask(taskId)) {
      const midjourneyStatus = await getMidjourneyImageStatus(taskId, apiKey);
      console.log(`Attempt ${i + 1}/${maxAttempts} - Midjourney task ${taskId} status:`, midjourneyStatus.status);
      if (midjourneyStatus.status === 'completed' && midjourneyStatus.imageUrls[0]) return midjourneyStatus.imageUrls[0];
      if (midjourneyStatus.status === 'failed') throw new Error(midjourneyStatus.error || 'Midjourney image generation failed');
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }
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
