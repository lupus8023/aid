import { WriterCharacter, WriterObject } from './types';

// 编剧阶段 prompt：把「一句话梗概」戏剧化成「有欲望/冲突/转折/潜台词/母题」的结构化故事。
// 与 storyAnalyzer 的分镜 prompt 相反：这里【鼓励创作】，分镜阶段才【忠实拆解】。
export function buildStoryPlanPrompt(input: {
  synopsis: string;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
}): string {
  const { synopsis, characters, objects, language } = input;
  const characterNames = characters.map(c => c.name).join('、');
  const characterDetails = characters.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const objectNames = objects.map(o => o.name).join('、');
  const objectDetails = objects.length ? objects.map(o => `- ${o.name}: ${o.description}`).join('\n') : '无';

  const langInstruction = language === 'en'
    ? 'MANDATORY: ALL output text (theme, logline, want, obstacle, arc, subtext, action, dialogue text, sceneStyle) MUST be in ENGLISH. Only character/object names keep their original form.'
    : '强制：所有输出文本（主题、logline、欲望、阻碍、弧线、潜台词、动作、台词、sceneStyle）必须使用中文。角色/物体名称保持原样。';

  return `你是一位资深编剧，擅长把一句话概念发展成有冲突、有转折、有潜台词、可视觉化的故事。
你的任务不是「扩写」，而是「戏剧化」：把梗概变成一个真正有故事性的结构。

🎯 最高原则：戏剧化，而不是罗列画面
- 没有转折就没有故事。你必须为这个梗概找到一个「转折点」——一件改变局面的小事。
- 每个角色必须有「想要的东西（want）」和「挡着他的东西（obstacle）」，这是戏剧性的根。
- 情绪弧线：起点情绪必须不同于终点情绪（如从压抑→释然，从疏离→靠近）。
- 台词必须有潜台词（subtext）：嘴上说的 ≠ 心里想的，不直说。
- 视觉母题（visualMotif）：一个反复出现的意象/道具，承载主题，首尾呼应（如一把伞、一盏灯、一封信）。

🌐 输出语言要求（强制）：
${langInstruction}

🚨 名称精确匹配（强制）
═══════════════════════════════════════════════════════════
1. 你只能使用用户上传的角色和物体名称。
2. beats[].characters 和 beats[].objects 数组中，只能出现上传列表里的精确名称。
3. 绝对禁止创造新角色名/物体名放进 characters/objects 数组。
4. 故事中需要但未上传的角色/物体（动物、路人、自然元素等）只在 action / promptDraft 中描述。
5. 每个已上传角色都应尽可能在故事中发挥作用；至少给每个主要角色一个 want/obstacle/arc。

📋 已上传角色（唯一允许的角色名称）
${characterDetails}

✅ 允许的角色名称: ${characterNames}

📦 已上传物体（唯一允许的物体名称）
${objectDetails}
${objects.length ? `✅ 允许的物体名称: ${objectNames}` : '⚠️ 未上传物体'}

📖 用户的故事梗概
${synopsis}

⏱ 时长推导（durationHint，强制按内容推导）
- 中文约 4.5 字/秒，英文约 2.5 词/秒。
- 有台词的镜头：durationHint = 台词字数/语速，中文一句 16-20 字 ≈ 3.5-4.5 秒。
- 无台词动作镜头：2-5 秒。
- 情绪停顿/留白镜头：4-8 秒（表达「电影感」的关键，不要全片一个速度）。
- 每个 beat 的 durationHint 是建议时长（秒），可以是一位小数；长镜头与短切交替才有节奏。

🎬 镜头/节奏要求
- beats 是【因果链】，不是并列画面：前一个 beat 导致后一个 beat。
- 每个 beat 只描述一个明确动作单元。
- 景别要多样（远景建场 → 中景 → 近景/特写），相邻镜头景别要有变化。
- 无镜头数量上限，按故事需要（3 到上百个都可以）；宁可按「动作链」拆细，也不要一个镜头堆多个动作。

📝 输出格式（只输出 JSON，不要其他任何内容）
{
  "theme": "一句话主题（谁 + 想得到什么 + 阻碍是什么）",
  "logline": "一句话梗概",
  "visualMotif": "视觉母题（一个反复出现的意象/道具，承载主题）",
  "emotionalArc": "全片情绪弧线（起点 → 转折 → 终点）",
  "characters": [
    { "name": "角色名", "want": "想要什么", "obstacle": "阻碍是什么", "arc": "情绪弧线", "subtext": "潜台词" }
  ],
  "sequences": [
    {
      "id": "seq-1",
      "locationId": "location_key",
      "sceneStyle": "场景环境与光影风格描述",
      "beats": [
        {
          "index": 1,
          "sequenceId": "seq-1",
          "locationId": "location_key",
          "shotSize": "景别（远景/全景/中景/近景/特写/大特写）",
          "cameraMove": "运镜（推/拉/摇/移/跟/静止/手持）",
          "angle": "机位（平视/仰拍/俯拍/过肩/FPV）",
          "action": "一个明确动作单元 + 情绪氛围（中文）",
          "characters": ["角色名"],
          "objects": ["物体名"],
          "dialogueLines": [ { "character": "角色名", "text": "带潜台词的台词（每镜最多一句）" } ],
          "durationHint": 4.5,
          "transition": "cut",
          "continuityFrom": 0,
          "sceneStyle": "本场环境与光影",
          "promptDraft": "图像 prompt 草稿：[角色名](外观关键词) 动作，环境，光影"
        }
      ]
    }
  ]
}

⚠️ 关键规则：
- locationId：同一地点的所有镜头用相同 locationId（英文小写下划线，如 cafe、street、room）。
- sequenceId：同一场（连续时间/地点）的镜头用相同 sequenceId。
- continuityFrom：需要与前一个镜头动作连贯时，写前一个 beat 的 index；否则写 0。
- transition：默认 "cut"；情绪切换或时间跳转可用 "dissolve"/"fade"。
- characters/objects 数组为空时写 []。
- promptDraft：已上传角色用 [名称](2-3 个外观关键词) 格式；临时角色/物体直接描述。

现在请开始，把这个梗概戏剧化成一个完整、有电影感的故事结构。`;
}
