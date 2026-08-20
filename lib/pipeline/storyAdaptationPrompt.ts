import { normalizeTargetShotCount, targetDurationSeconds } from './shotCount';

export function buildStoryAdaptationPrompt(input: {
  brief: string;
  language?: 'zh' | 'en';
  targetShotCount?: number;
}): string {
  const language = input.language === 'en' ? 'en' : 'zh';
  const targetShots = normalizeTargetShotCount(input.targetShotCount);
  const targetSeconds = targetDurationSeconds(targetShots);
  const shotDigits = String(targetShots).length;
  const outputRule = language === 'en'
    ? `Write the entire adapted screenplay in English. Output exactly ${targetShots} numbered story beats, from SHOT ${String(1).padStart(shotDigits, '0')} through SHOT ${targetShots}.`
    : `使用中文输出完整改编剧本。严格输出 ${targetShots} 个编号剧情节拍，从“镜头 ${String(1).padStart(shotDigits, '0')}”连续写到“镜头 ${targetShots}”。`;
  const lineFormat = language === 'en'
    ? `SHOT NN | sequence/location | one visible action that changes the situation | dialogue: exact short line or NONE`
    : `镜头 NN｜场次/地点｜一个会改变局面的可见动作｜台词：逐字短句或“无”`;

  return `你是一位影视改编编剧。用户提供的可能是一句话构想、故事梗概、小说片段或详细剧本。你的任务不是泛化扩写，而是把原文改编成符合 AID 制作规格、能继续生成分镜的镜头节拍剧本。

AID 制作规格（最高优先级）：
- ${outputRule}
- 目标成片约 ${targetSeconds} 秒，平均每镜约 5 秒；允许根据台词、动作和情绪停顿微调，但不得改变镜头总数。
- 先在内部把 ${targetShots} 镜分配给开场、发展、升级、高潮和收束，并确保各场额度之和严格等于 ${targetShots}。
- 每个镜头只写一个明确、可见、可表演的动作单元；前一镜的结果必须成为后一镜的原因。
- 镜头编号不得重复、跳号、合并或用“若干镜头”“蒙太奇数镜”等方式代替。

改编原则：
- 保留用户明确给出的剧情事实、人物关系、事件顺序、结局、风格、禁止事项和指定台词；用户文本中的其他镜头数要求与 AID 制作规格冲突时，以 ${targetShots} 镜为准。
- 输入越具体，剧情改动越少；只补足因果、转场、可见动作和必要的情绪推进，不另造核心设定。
- 若原文内容不足以支撑 ${targetShots} 镜，通过动作过程、反应、选择、后果和环境互动增加有效剧情节拍，禁止用重复走路、凝视或空镜凑数。
- 若原文内容过多，合并重复信息但保留关键事件，绝不能把多个关键动作塞进同一镜。
- 用户未要求对白、旁白或口播时，优先以动作和表情叙事。不得添加画外音、路人台词、笑声、哼唱或无来源人声。
- 用户指定台词必须逐字保留；新增台词必须简短、自然且只在画面无法表达关键信息时使用。
- 本阶段只改编故事，不写焦距、运镜、光圈、摄影参数、图片提示词或视频提示词。

输出格式：
1. 先用不超过 5 行写：片名、故事主线、人物目标、核心阻碍、情绪弧线。
2. 再按场次分组，但每个镜头必须各占一行并严格使用以下格式：
${lineFormat}
3. 输出前逐项自检：必须恰好存在 ${targetShots} 行镜头节拍，最后一行编号必须是 ${targetShots}。
4. 只输出改编后的剧本，不解释改编过程。

用户原始输入：
${input.brief.trim()}`;
}
