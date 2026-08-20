import type { Storyboard } from '@/types';
import type { StoryPlan, Beat, WriterCharacter, WriterObject } from './types';
import { chatOnce, type ScriptProvider } from './llm';
import { extractJson } from './json';
import type { VisualStyle } from '@/types';
import { buildImageCaptureContract, getProductionStylePreset } from '@/lib/promptArchitecture';

// 导演阶段：把编剧产出的 StoryPlan 可视化成分镜（Storyboard[]）。
// 关键点：镜头数量/顺序/台词/时长/转场/连续关系【忠实于 StoryPlan】，只补画面/视频提示词与定妆。
function buildDirectorPrompt(input: {
  storyPlan: StoryPlan;
  beats: Beat[];
  batchNumber: number;
  totalBatches: number;
  previousShots?: Array<Record<string, unknown>>;
  continuesSequence?: boolean;
  nextBeats?: Beat[];
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
  visualStyle?: VisualStyle;
}): string {
  const { storyPlan, beats, batchNumber, totalBatches, previousShots = [], continuesSequence = false, nextBeats = [], characters, objects, language, visualStyle } = input;
  const characterDetails = characters.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const objectDetails = objects.length ? objects.map(o => `- ${o.name}: ${o.description}`).join('\n') : '无';
  const firstIndex = beats[0]?.index || 0;
  const lastIndex = beats[beats.length - 1]?.index || 0;
  const stylePreset = getProductionStylePreset(visualStyle);

  const langInstruction = language === 'en'
    ? 'MANDATORY: output description, prompt and characterCostume in ENGLISH.'
    : '强制：description 使用中文，prompt 使用英文，characterCostume 使用具体可视描述。';

  const storySpine = {
    title: storyPlan.title,
    theme: storyPlan.theme,
    logline: storyPlan.logline,
    protagonist: storyPlan.protagonist,
    externalWant: storyPlan.externalWant,
    internalNeed: storyPlan.internalNeed,
    stakes: storyPlan.stakes,
    obstacle: storyPlan.obstacle,
    finalChoice: storyPlan.finalChoice,
    consequence: storyPlan.consequence,
    change: storyPlan.change,
    storyAnchor: storyPlan.storyAnchor,
    visualMotif: storyPlan.visualMotif,
    emotionalArc: storyPlan.emotionalArc,
  };

  return `你是一位电影导演兼分镜师。全片剧本已经锁定。现在只处理导演批次 ${batchNumber}/${totalBatches}（镜头 ${firstIndex}–${lastIndex}），把本批 beats 可视化为可拍摄分镜。

📌 用户原始输入仍是最高优先级：
${storyPlan.sourceBrief || '（旧项目未保存原始输入，请以 StoryPlan 为准）'}

编剧对用户意图的理解：${storyPlan.intentSummary || '未提供'}
需求核对表：${JSON.stringify(storyPlan.requirements || [], null, 2)}

🎯 最高原则：忠实于 StoryPlan，不重新创作
- 本批分镜数量必须等于 ${beats.length}，顺序与 index ${firstIndex}–${lastIndex} 完全一致，不得增删或重排。
- 台词、动作、时长、转场和连续关系来自 beat；你负责设计景别、运镜、机位、场景成像基线与正式图片 prompt。
- 必须让 dramaticPurpose、cause、conflict、choice、consequence 和 stateBefore/stateAfter 在画面中可见；镜头必须改变信息、关系、决定或物理状态，不能只制造氛围。
- 不得添加 beat 中没有的情节、台词、旁白、画外音、声音或角色行为。
- 如果用户原始输入含有 beat 未重复写出的明确视觉、服装、场景或语气要求，必须落实到 description/prompt，但不得改变剧情与镜头数量。

🌐 ${langInstruction}

🚨 名称精确匹配（强制）：characters/objects 只允许使用已上传名称；临时角色/物体只在 prompt/description 里直接描述。

📋 已上传角色：
${characterDetails}
📦 已上传物体：
${objectDetails}

📖 全片故事脊柱：
${JSON.stringify(storySpine, null, 2)}

上一批最后两镜的视觉交接：
${JSON.stringify(previousShots.slice(-2), null, 2)}

交接类型：${continuesSequence
  ? '同一场次续拍。保持人物位置和银幕方向、服装、道具、主光方向、空间关系与曝光基线。'
  : '新场次开始。保持人物身份、服装、关键道具和剧情状态；允许按新场次明确重建地点、时间、光源、构图和银幕方向。'}

本批详细剧本（权威）：
${JSON.stringify(beats, null, 2)}

后续两镜剧情目标（只铺垫，不得提前发生）：
${JSON.stringify(nextBeats.slice(0, 2).map(beat => ({ index: beat.index, action: beat.action, cause: beat.cause, dramaticPurpose: beat.dramaticPurpose })), null, 2)}

🎬 分镜可视化要求：
1. description：必须以「[景别，机位角度]」开头，包含动作主体、环境、情绪氛围、运镜方式、物理细节（布料/水流/光影）。
2. prompt（英文图像提示词）：
   - 已上传角色/物体用 [名称](2-3 个外观关键词) 格式；临时角色/物体直接描述。
   - 不要写成关键词堆砌。使用紧凑的摄影因果链，顺序固定为：SUBJECT/ACTION → CAMERA POSITION & DISTANCE → LENS PERSPECTIVE → COMPOSITION & OCCLUSION → FOCUS PLANE & DEPTH LAYERS → MOTIVATED LIGHT → EXPOSURE/COLOR/MATERIAL RESPONSE。
   - CAMERA 必须写清相机相对主体的高度、距离和朝向；不能只写 eye-level、close-up。
   - COMPOSITION 必须写清主体在画面中的位置、留白方向，以及前景/中景/背景关系；需要时使用真实遮挡、非对称裁切或贴近地面的机位，不要每镜都中央构图。
   - FOCUS 必须指定唯一焦点平面，并说明近景与远景如何衰减；景深由焦距感、相机距离、主体与背景距离共同决定，禁止无理由地每镜都浅景深或整幅虚化。
   - LIGHT 必须来自场景中可解释的方向与光源，写清软硬、大小、反射/负补光、阴影密度与距离衰减；同一 sequence 延续光源方向，但每个机位呈现不同的入射角和材质反应。
   - IMAGE RESPONSE 必须描述有限动态范围、高光滚降、暗部层次、白平衡与皮肤/布料/金属/水面等材质的漫反射和高光。仅在成像系统支持时加入轻微颗粒、暗角、边缘柔化、色散、光晕或手机锐化，禁止随机堆叠镜头缺陷。
   - 每条 prompt 控制在 65–95 个英文词；最重要、最独特的摄影信息放在前 45 个词，保证九宫格压缩后仍保留镜头差异。
   - 禁止艺术风格词（anime/cartoon/Ghibli/realistic 等），视觉风格由参考图决定。
   - 精确执行 beat.characters：每个列出的角色在画面中只出现一次，未列出的角色不出现；角色设定图中的多角度/多姿势只用于识别同一身份，不得复制为多人。
   - 禁止字幕、标题、对白文字、气泡、Logo、水印或任何可读文字。
3. characterCostume：为每个在本镜头出现的角色给一套服装/发型/配饰/颜色描述，跨镜头保持一致。
4. shotSize / cameraMove / angle：为剧本动作选择一个明确且可执行的景别、单一物理运镜和机位；相邻镜头避免机械重复。
5. sceneStyle：用紧凑英文记录本 sequence 的相机/镜头家族、主光方向与软硬/色温、环境反射或负补光、有限曝光、高光滚降、阴影密度、色彩响应和主要材质。连续 sequence 内保持相同基线。

🎥 项目成像基线（只用于落实摄影物理，不要原样复制成长段落）：
Selected production style: ${stylePreset.label} — ${stylePreset.description}
${buildImageCaptureContract(visualStyle)}

连续镜头应共享同一相机/镜头家族、色彩响应、主光方向和场景材质；每镜只改变有叙事理由的机位、距离、焦点、遮挡和曝光反应。真实感来自一致的物理因果，而不是反复添加 cinematic、8K、masterpiece、photorealistic 等泛化词。

不要输出视频生成提示词。下游会把 1–4 个分镜重新编组成一个不超过 15 秒的 H3 片段，并按统一制作风格生成时间轴式导演说明。

📝 输出（只输出 JSON 数组，按 beat 顺序，第 i 个元素对应第 i 个 beat）：
[
  {
    "index": ${firstIndex},
    "description": "镜头描述",
    "prompt": "English image prompt",
    "shotSize": "景别",
    "cameraMove": "单一物理运镜",
    "angle": "机位",
    "sceneStyle": "English scene capture baseline",
    "characterCostume": { "角色名": "服装造型描述" }
  }
]`;
}

// 合并 LLM 输出的画面化字段与 beat 的结构字段，产出最终 Storyboard[]。
function mergeBeats(
  storyPlan: StoryPlan,
  rawShots: any[],
  aspectRatio: Storyboard['aspectRatio'],
): Storyboard[] {
  const beats = storyPlan.sequences.flatMap(seq => seq.beats.map(beat => ({ ...beat, sceneStyle: beat.sceneStyle || seq.sceneStyle })));

  return beats.map((beat: Beat, i: number) => {
    const raw = Array.isArray(rawShots) ? rawShots[i] : undefined;
    const continuityFrom = beat.continuityFrom && beat.continuityFrom > 0
      ? `scene-${beat.continuityFrom}`
      : undefined;

    return {
      id: `scene-${i + 1}`,
      sceneNumber: i + 1,
      sequenceId: beat.sequenceId,
      locationId: beat.locationId,
      description: typeof raw?.description === 'string' ? raw.description : beat.action,
      prompt: typeof raw?.prompt === 'string' ? raw.prompt : beat.promptDraft || beat.action,
      videoPrompt: undefined,
      characters: beat.characters,
      objects: beat.objects,
      dialogueLines: beat.dialogueLines,
      speech: beat.speech,
      audioPlan: beat.audioPlan,
      clipType: beat.clipType,
      shotSize: typeof raw?.shotSize === 'string' ? raw.shotSize : beat.shotSize,
      cameraMove: typeof raw?.cameraMove === 'string' ? raw.cameraMove : beat.cameraMove,
      angle: typeof raw?.angle === 'string' ? raw.angle : beat.angle,
      dramaticPurpose: beat.dramaticPurpose,
      cause: beat.cause,
      conflict: beat.conflict,
      choice: beat.choice,
      consequence: beat.consequence,
      characterChange: beat.characterChange,
      nextCause: beat.nextCause,
      stateBefore: beat.stateBefore,
      stateAfter: beat.stateAfter,
      durationHint: beat.durationHint,
      videoDuration: beat.durationHint, // 内容驱动时长：让每个镜头有长有短
      transition: beat.transition,
      continuityFrom,
      continuousFromPrev: Boolean(continuityFrom),
      sceneStyle: typeof raw?.sceneStyle === 'string' ? raw.sceneStyle : beat.sceneStyle,
      characterCostume: raw?.characterCostume && typeof raw.characterCostume === 'object' ? raw.characterCostume : undefined,
      status: 'pending' as const,
      aspectRatio,
    };
  });
}

export function buildDirectorBatches(storyPlan: StoryPlan, maxBatchSize = 9): Beat[][] {
  const size = Math.max(1, Math.min(9, Math.floor(maxBatchSize) || 9));
  const batches: Beat[][] = [];
  for (const sequence of storyPlan.sequences) {
    for (let index = 0; index < sequence.beats.length; index += size) {
      batches.push(sequence.beats.slice(index, index + size));
    }
  }
  return batches;
}

function parsedDirectorShots(value: any): any[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.shots) ? value.shots : [];
}

export async function directStoryboard(input: {
  storyPlan: StoryPlan;
  characters: WriterCharacter[];
  objects: WriterObject[];
  apiKey: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  language?: 'zh' | 'en';
  visualStyle?: VisualStyle;
  scriptProvider?: ScriptProvider;
  scriptModel?: string;
  dmxApiKey?: string;
}): Promise<Storyboard[]> {
  const { storyPlan, characters, objects, apiKey, aspectRatio, language = 'zh', visualStyle, scriptProvider, scriptModel = 'gpt-4o', dmxApiKey } = input;
  const batches = buildDirectorBatches(storyPlan);
  const allBeats = storyPlan.sequences.flatMap(sequence => sequence.beats);
  const rawShots: any[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const beats = batches[batchIndex];
    const lastIndex = beats[beats.length - 1]?.index || 0;
    const prompt = buildDirectorPrompt({
      storyPlan,
      beats,
      batchNumber: batchIndex + 1,
      totalBatches: batches.length,
      previousShots: rawShots.slice(-2).map(shot => ({
        index: shot.index,
        description: shot.description,
        shotSize: shot.shotSize,
        angle: shot.angle,
        sceneStyle: shot.sceneStyle,
        characterCostume: shot.characterCostume,
      })),
      continuesSequence: rawShots.length > 0 && rawShots[rawShots.length - 1]?.sequenceId === beats[0]?.sequenceId,
      nextBeats: allBeats.filter(beat => beat.index > lastIndex).slice(0, 2),
      characters,
      objects,
      language,
      visualStyle,
    });
    let batchShots: any[] | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2 && !batchShots; attempt += 1) {
      try {
        const correction = attempt === 1
          ? ''
          : `\n\nCORRECTION RETRY: the previous response was invalid (${lastError instanceof Error ? lastError.message : 'unknown error'}). Return only a complete JSON array with exactly ${beats.length} items.`;
        console.log(`[story-director] batch ${batchIndex + 1}/${batches.length}, attempt ${attempt}/2`);
        const response = await chatOnce(`${prompt}${correction}`, {
          apiKey,
          dmxApiKey,
          provider: scriptProvider,
          model: scriptModel,
          maxOutputTokens: 7_000,
          timeoutMs: process.env.AID_LOCAL_COMPANION === '1' ? 120_000 : 48_000,
        });
        const parsed = parsedDirectorShots(extractJson(response));
        if (parsed.length !== beats.length) throw new Error(`返回 ${parsed.length} 镜，要求 ${beats.length} 镜`);
        batchShots = parsed.map((shot, index) => ({
          ...shot,
          index: beats[index].index,
          sequenceId: beats[index].sequenceId,
        }));
      } catch (error) {
        lastError = error;
        console.warn(`[story-director] batch ${batchIndex + 1} failed:`, error instanceof Error ? error.message : error);
        if (/timeout|timed out|ECONNABORTED/i.test(error instanceof Error ? error.message : String(error))) break;
      }
    }
    if (!batchShots) {
      const first = beats[0]?.index || 0;
      const last = beats[beats.length - 1]?.index || 0;
      throw new Error(`分镜提示词 ${first}–${last} 生成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
    rawShots.push(...batchShots);
  }

  return mergeBeats(storyPlan, rawShots, aspectRatio);
}
