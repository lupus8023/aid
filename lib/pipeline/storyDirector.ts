import { Storyboard } from '@/types';
import { StoryPlan, Beat, WriterCharacter, WriterObject } from './types';
import { chatOnce, type ScriptProvider } from './llm';
import { extractJson } from './json';

// 导演阶段：把编剧产出的 StoryPlan 可视化成分镜（Storyboard[]）。
// 关键点：镜头数量/顺序/台词/时长/转场/连续关系【忠实于 StoryPlan】，只补画面/视频提示词与定妆。
function buildDirectorPrompt(input: {
  storyPlan: StoryPlan;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
}): string {
  const { storyPlan, characters, objects, language } = input;
  const characterDetails = characters.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const objectDetails = objects.length ? objects.map(o => `- ${o.name}: ${o.description}`).join('\n') : '无';
  const beatCount = storyPlan.sequences.reduce((n, s) => n + s.beats.length, 0);

  const langInstruction = language === 'en'
    ? 'MANDATORY: output description, prompt and characterCostume in ENGLISH.'
    : '强制：description 使用中文，prompt 使用英文，characterCostume 使用具体可视描述。';

  return `你是一位电影导演兼分镜师。下面是编剧已经完成的【故事结构 StoryPlan】与角色/物体设定。你的任务是把每个 beat 可视化成一个可拍摄的分镜。

📌 用户原始输入仍是最高优先级：
${storyPlan.sourceBrief || '（旧项目未保存原始输入，请以 StoryPlan 为准）'}

编剧对用户意图的理解：${storyPlan.intentSummary || '未提供'}
需求核对表：${JSON.stringify(storyPlan.requirements || [], null, 2)}

🎯 最高原则：忠实于 StoryPlan，不重新创作
- 分镜数量必须等于 ${beatCount}，顺序与 beats 完全一致，不得增删或重排。
- 台词、景别、运镜、机位、时长、转场、连续关系都来自 beat，你只负责【画面化】。
- 不得添加 beat 中没有的情节、台词、旁白、画外音、声音或角色行为。
- 如果用户原始输入含有 beat 未重复写出的明确视觉、服装、场景或语气要求，必须落实到 description/prompt，但不得改变剧情与镜头数量。

🌐 ${langInstruction}

🚨 名称精确匹配（强制）：characters/objects 只允许使用已上传名称；临时角色/物体只在 prompt/description 里直接描述。

📋 已上传角色：
${characterDetails}
📦 已上传物体：
${objectDetails}

📖 StoryPlan（JSON）：
${JSON.stringify(storyPlan, null, 2)}

🎬 分镜可视化要求：
1. description（中文镜头描述）：必须以「[景别，机位角度]」开头，包含动作主体、环境、情绪氛围、运镜方式、物理细节（布料/水流/光影）。
2. prompt（英文图像提示词）：
   - 已上传角色/物体用 [名称](2-3 个外观关键词) 格式；临时角色/物体直接描述。
   - 包含景别、角度、构图、动作、表情、光影、景深。
   - 禁止艺术风格词（anime/cartoon/Ghibli/realistic 等），视觉风格由参考图决定。
   - 精确执行 beat.characters：每个列出的角色在画面中只出现一次，未列出的角色不出现；角色设定图中的多角度/多姿势只用于识别同一身份，不得复制为多人。
   - 禁止字幕、标题、对白文字、气泡、Logo、水印或任何可读文字。
3. characterCostume：为每个在本镜头出现的角色给一套服装/发型/配饰/颜色描述，跨镜头保持一致。

不要输出视频生成提示词。下游会把 1–4 个分镜重新编组成一个不超过 15 秒的 H3 片段，并按统一制作风格生成时间轴式导演说明。

📝 输出（只输出 JSON 数组，按 beat 顺序，第 i 个元素对应第 i 个 beat）：
[
  {
    "index": 1,
    "description": "中文镜头描述",
    "prompt": "English image prompt",
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

export async function directStoryboard(input: {
  storyPlan: StoryPlan;
  characters: WriterCharacter[];
  objects: WriterObject[];
  apiKey: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  language?: 'zh' | 'en';
  scriptProvider?: ScriptProvider;
  scriptModel?: string;
  dmxApiKey?: string;
}): Promise<Storyboard[]> {
  const { storyPlan, characters, objects, apiKey, aspectRatio, language = 'zh', scriptProvider, scriptModel = 'gpt-4o', dmxApiKey } = input;
  const prompt = buildDirectorPrompt({ storyPlan, characters, objects, language });

  const response = await chatOnce(prompt, { apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel });

  const parsed = extractJson(response);
  const rawShots: any[] = Array.isArray(parsed) ? parsed : [];

  return mergeBeats(storyPlan, rawShots, aspectRatio);
}
