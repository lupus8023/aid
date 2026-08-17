import { WriterCharacter, WriterObject } from './types';
import { normalizeTargetShotCount, targetDurationSeconds } from './shotCount';

// 编剧阶段 prompt：先准确理解用户约束，再把允许创作的空白发展成结构化故事。
// 与 storyAnalyzer 的分镜 prompt 相反：这里【鼓励创作】，分镜阶段才【忠实拆解】。
export function buildStoryPlanPrompt(input: {
  synopsis: string;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
  targetShotCount?: number;
}): string {
  const { synopsis, characters, objects, language } = input;
  const targetShots = normalizeTargetShotCount(input.targetShotCount);
  const targetSeconds = targetDurationSeconds(targetShots);
  const characterNames = characters.map(c => c.name).join('、');
  const characterDetails = characters.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const objectNames = objects.map(o => o.name).join('、');
  const objectDetails = objects.length ? objects.map(o => `- ${o.name}: ${o.description}`).join('\n') : '无';

  const langInstruction = language === 'en'
    ? 'MANDATORY: ALL output text (theme, logline, want, obstacle, arc, subtext, action, dialogue text, sceneStyle) MUST be in ENGLISH. Only character/object names keep their original form.'
    : '强制：所有输出文本（主题、logline、欲望、阻碍、弧线、潜台词、动作、台词、sceneStyle）必须使用中文。角色/物体名称保持原样。';

  return `你是一位资深编剧兼需求分析师。用户输入可能是一句话概念，也可能是详细剧本、镜头要求、风格说明或禁止事项。
你的首要任务是准确执行用户意图；只有用户没有规定的部分，才由你进行专业的戏剧化创作。

🧭 指令优先级（从高到低，强制）
1. 用户明确写出的剧情事实、人物关系、场景、事件顺序、结局、指定台词、时长/镜头数、风格与禁止事项。
2. 已上传角色与物体的名称和描述。
3. 下方通用编剧原则。

需求理解规则：
- 不要把详细剧本误当成一句话灵感重写；输入越具体，改动越少。
- 不得删掉、替换、反转或弱化用户明确要求的事件和结局；不得擅自改变人物关系、时代、地点或类型。
- “不要/避免/必须/只要/保持/结尾是”等约束视为 must，绝不能被“更有戏剧性”覆盖。
- 如果用户指定镜头数量、总时长或结构，严格遵守；未指定时才按内容推导。
- 只在原文留白处补充因果、动作、过渡和潜台词。补充内容不得与原文冲突。
- 在输出前逐条自检：每个 must 要求必须能指向至少一个 beat；禁止事项的 coveredBy 可指向落实该约束的相关 beats。

🎯 最高原则：戏剧化，而不是罗列画面
- 在不违背用户要求时，为故事寻找自然的局面变化；若用户明确要求平静、纪实、无反转，则不要强加转折。
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
5. 用户明确要求出现的角色必须发挥作用；不要为了“用完素材”把无关角色强塞进故事。

📋 已上传角色（唯一允许的角色名称）
${characterDetails}

✅ 允许的角色名称: ${characterNames}

📦 已上传物体（唯一允许的物体名称）
${objectDetails}
${objects.length ? `✅ 允许的物体名称: ${objectNames}` : '⚠️ 未上传物体'}

📖 用户原始输入（最高优先级，不得遗漏明确要求）
${synopsis}

⏱ 时长推导（durationHint，强制按内容推导）
- 中文约 4.5 字/秒，英文约 2.5 词/秒。
- 有台词的镜头：durationHint = 台词字数/语速，中文一句 16-20 字 ≈ 3.5-4.5 秒。
- 无台词动作镜头：2-5 秒。
- 情绪停顿/留白镜头：4-8 秒（表达「电影感」的关键，不要全片一个速度）。
- 每个 beat 的 durationHint 是建议时长（秒），可以是一位小数；长镜头与短切交替才有节奏。

🎬 镜头/节奏要求
- 全片必须严格输出 ${targetShots} 个 beats，不多不少；这是制作规格，不是建议。
- 写 beats 前先在内部给 sequences 分配镜头额度，各 sequence 的 beats 数相加必须等于 ${targetShots}。
- 目标总片长约 ${targetSeconds} 秒。各镜头 durationHint 仍按内容推导，但全片 durationHint 总和应尽量接近该片长。
- beats 是【因果链】，不是并列画面：前一个 beat 导致后一个 beat。
- 每个 beat 只描述一个明确动作单元。
- 景别要多样（远景建场 → 中景 → 近景/特写），相邻镜头景别要有变化。
- 宁可按「动作链」合理分配，也不要一个镜头堆多个动作；同时不得超出或少于 ${targetShots} 镜。

📝 输出格式（只输出 JSON，不要其他任何内容）
{
  "intentSummary": "用1-3句话准确复述用户要做什么，不添加用户没说的核心设定",
  "requirements": [
    {
      "id": "req-1",
      "text": "一条可核验的用户要求（简洁改写，不曲解）",
      "category": "plot|character|setting|tone|format|pacing|dialogue|visual|avoid|other",
      "priority": "must|preference",
      "coveredBy": [1, 2]
    }
  ],
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
- requirements 必须覆盖用户输入中的所有显式要求；must 的 coveredBy 不得为空（纯全局格式要求可列出全部相关 beat）。
- beat.index 在全片范围内从 1 连续递增，不能在新 sequence 里重新从 1 开始。
- locationId：同一地点的所有镜头用相同 locationId（英文小写下划线，如 cafe、street、room）。
- sequenceId：同一场（连续时间/地点）的镜头用相同 sequenceId。
- continuityFrom：需要与前一个镜头动作连贯时，写前一个 beat 的 index；否则写 0。
- transition：默认 "cut"；情绪切换或时间跳转可用 "dissolve"/"fade"。
- characters/objects 数组为空时写 []。
- promptDraft：已上传角色用 [名称](2-3 个外观关键词) 格式；临时角色/物体直接描述。
- 最终自检 sequences[].beats 的总数必须严格等于 ${targetShots}，beat.index 必须为 1–${targetShots}。

现在请开始，把这个梗概戏剧化成一个完整、有电影感的故事结构。`;
}
