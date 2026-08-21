import type { WriterCharacter, WriterObject } from './types';
import { normalizeTargetShotCount, targetDurationSeconds } from './shotCount';

export function buildStoryOutlinePrompt(input: {
  synopsis: string;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
  targetShotCount?: number;
}): string {
  const { synopsis, characters, objects, language } = input;
  const targetShots = normalizeTargetShotCount(input.targetShotCount);
  const targetSeconds = targetDurationSeconds(targetShots);
  const characterDetails = characters.map(character => `- ${character.name}: ${character.description}`).join('\n');
  const objectDetails = objects.length
    ? objects.map(object => `- ${object.name}: ${object.description}`).join('\n')
    : 'None';
  const outputLanguage = language === 'en'
    ? 'All story text must be English; preserve uploaded entity names exactly.'
    : '所有故事文本必须使用中文；已上传实体名称保持原样。';

  return `你是长片总编剧。只做【全片故事骨架与镜头地图】，不要写详细分镜、摄影 prompt、声音设计或逐镜状态 JSON。

最高优先级：准确执行用户明确的剧情、人物关系、顺序、结局、台词、风格与禁止事项；只在留白处创作。
${outputLanguage}

用户原始输入：
${synopsis}

已上传角色（characters 只能使用这些精确名称）：
${characterDetails}

已上传物体（objects 只能使用这些精确名称）：
${objectDetails}

制作规格：全片严格 ${targetShots} 镜，目标约 ${targetSeconds} 秒。

先锁定全片因果链、人物弧线、高潮选择、结局、伏笔回收，再分配 sequences。每个 sequence 的 beatMap 只写一句极简镜头地图；所有 beatMap 合计必须严格 ${targetShots} 条，全片 index 从 1 连续到 ${targetShots}。

连续性规则：
- 前一条 consequence 必须成为后一条 cause，或明确推动下一场。
- actionGoal 是该镜头唯一可见动作/局面变化，不是摄影描述。
- emotionalTurn 写镜头前后变化；没有变化也要写“保持X但新增Y信息”。
- 用户指定台词在 beatMap 的 requiredLine 中逐字保留；未指定则留空，禁止新增旁白或无来源人声。
- sequence 的 entryState / exitState 必须能交接人物位置、关系、关键道具与情绪。
- 不要输出 shotSize、cameraMove、angle、sceneStyle、promptDraft、audioPlan、stateBefore 或 stateAfter；这些由后续阶段分批完成。

只输出以下 JSON 对象：
{
  "intentSummary": "准确复述用户要求",
  "requirements": [{ "id": "req-1", "text": "可核验要求", "category": "plot|character|setting|tone|format|pacing|dialogue|visual|avoid|other", "priority": "must|preference", "coveredBy": [1] }],
  "title": "片名",
  "theme": "主题",
  "logline": "一句话梗概",
  "protagonist": "主角名",
  "externalWant": "外在目标",
  "internalNeed": "内在需求",
  "stakes": "失败代价",
  "obstacle": "核心阻碍",
  "finalChoice": "高潮选择",
  "consequence": "最终结果",
  "change": "人物变化",
  "storyAnchor": "故事锚点",
  "visualMotif": "视觉母题",
  "emotionalArc": "全片情绪弧线",
  "characters": [{ "name": "已上传角色名", "want": "欲望", "obstacle": "阻碍", "arc": "弧线", "subtext": "潜台词" }],
  "sequences": [{
    "id": "seq-1",
    "locationId": "english_location_key",
    "sceneGoal": "本场必须完成的剧情目标",
    "entryState": "人物/关系/道具/情绪入场状态",
    "exitState": "本场结束状态，供下一场继承",
    "shotCount": 9,
    "beatMap": [{
      "index": 1,
      "actionGoal": "唯一可见动作与局面变化",
      "cause": "直接前因",
      "consequence": "直接后果",
      "emotionalTurn": "情绪或认知变化",
      "requiredLine": "用户指定台词或空字符串"
    }]
  }]
}

输出前自检：sequences[].shotCount 之和、beatMap 长度之和都必须等于 ${targetShots}；index 必须无重复、无跳号地覆盖 1–${targetShots}。`;
}

export function buildStoryBeatBatchPrompt(input: {
  synopsis: string;
  outline: unknown;
  sequence: unknown;
  beatMap: Array<{ index: number }>;
  previousBoundary?: unknown;
  continuesSequence?: boolean;
  nextRoadmap?: Array<{ index: number }>;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
}): string {
  const { synopsis, outline, sequence, beatMap, previousBoundary, continuesSequence = false, nextRoadmap = [], characters, objects, language } = input;
  const outlineRecord = (outline && typeof outline === 'object' ? outline : {}) as Record<string, unknown>;
  const firstIndex = Number(beatMap[0]?.index || 0);
  const lastIndex = Number(beatMap[beatMap.length - 1]?.index || 0);
  const outputLanguage = language === 'en'
    ? 'All action, story, dialogue and state text must be English. Technical sound strings may also be English.'
    : 'action、剧情、状态和台词使用中文；sceneStyle、环境声和拟音使用简洁英文。';
  const storySpine = {
    title: outlineRecord.title,
    theme: outlineRecord.theme,
    logline: outlineRecord.logline,
    protagonist: outlineRecord.protagonist,
    externalWant: outlineRecord.externalWant,
    internalNeed: outlineRecord.internalNeed,
    stakes: outlineRecord.stakes,
    obstacle: outlineRecord.obstacle,
    finalChoice: outlineRecord.finalChoice,
    consequence: outlineRecord.consequence,
    change: outlineRecord.change,
    storyAnchor: outlineRecord.storyAnchor,
    visualMotif: outlineRecord.visualMotif,
    emotionalArc: outlineRecord.emotionalArc,
  };

  return `你是执行编剧。全片骨架已经锁定，只展开镜头 ${firstIndex}–${lastIndex} 的【详细剧本】，不得重写故事、改变镜头数量或提前/延后结局。

${outputLanguage}

用户原始输入（用于核对指定事实和逐字台词）：
${synopsis}

全片故事脊柱：
${JSON.stringify(storySpine, null, 2)}

当前场次：
${JSON.stringify(sequence, null, 2)}

本批权威镜头地图（顺序与因果不可改变）：
${JSON.stringify(beatMap, null, 2)}

上一批交接状态（为空表示全片开场）：
${JSON.stringify(previousBoundary || null, null, 2)}

交接类型：${continuesSequence
  ? '同一场次续写。第一镜必须逐项继承人物位置、姿态、持物、服装、空间关系、时间和环境状态。'
  : '新场次开始。必须继承人物身份、服装、关系变化、已获得/失去的关键物和未解决因果；允许通过明确转场改变地点、时间、人物位置和环境状态。'}

后续两镜路线提示（只为铺垫，不得在本批提前发生）：
${JSON.stringify(nextRoadmap.slice(0, 2), null, 2)}

允许角色：
${characters.map(character => `- ${character.name}: ${character.description}`).join('\n')}
允许物体：
${objects.length ? objects.map(object => `- ${object.name}: ${object.description}`).join('\n') : 'None'}

写作规则：
- 严格输出 ${beatMap.length} 个 beats，对应 index ${firstIndex}–${lastIndex}；每个 beat 只展开对应 beatMap，不得合并、拆分、增删或调序。
- characters / objects 只能使用允许列表中的精确名称；临时环境元素只写在 action。
- cause → conflict → choice → consequence → nextCause 必须形成可见因果；前一镜 stateAfter 必须等于后一镜 stateBefore。
- 第一镜 stateBefore 必须按照上述交接类型承接上一批；最后一镜 nextCause 要准确铺向后续路线。
- 台词克制。beatMap.requiredLine 非空时逐字写入 speech；否则只有画面无法表达的关键信息才允许一名当前角色说一句。禁止旁白、画外音、路人台词、笑声、哼唱和无来源人声。
- speech 每镜最多一条；audioPlan 是唯一声音源。backgroundHuman 默认 none；环境声和拟音必须由地点或可见动作引起；未要求音乐时 music 为 none。
- 不生成摄影内容：不要输出 promptDraft、sceneStyle、shotSize、cameraMove、angle 或图像 prompt。

只输出：
{
  "beats": [{
    "index": ${firstIndex},
    "action": "一个明确、可见、可表演的动作单元",
    "characters": ["允许角色名"],
    "objects": ["允许物体名"],
    "clipType": "insert|reaction|establishing|action|dialogue|performance|montage|long_take",
    "dramaticPurpose": "本镜改变了什么",
    "cause": "直接前因",
    "conflict": "阻力或两难",
    "choice": "可见选择或空字符串",
    "consequence": "可见结果",
    "characterChange": "情绪/认知变化",
    "nextCause": "下一镜直接原因",
    "speech": [{ "character": "当前角色", "exactLine": "只填写角色真正说出口的逐字台词；导演指令必须留在 speech 之外", "emotion": "克制情绪", "delivery": "语速停顿重音", "volume": "whisper|soft|normal|raised", "lipSync": true, "source": "user_exact|story_required" }],
    "audioPlan": { "backgroundHuman": "none|indistinct_nonverbal", "environment": ["sound"], "foley": ["sound"], "music": "none", "silenceBefore": 0.0, "silenceAfter": 0.4 },
    "stateBefore": { "characters": "位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "关系状态", "emotion": "情绪状态" },
    "stateAfter": { "characters": "位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "关系状态", "emotion": "情绪状态" },
    "durationHint": 4.5,
    "transition": "cut|dissolve|fade|wipe",
    "continuityFrom": 0
  }]
}`;
}

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

🎯 Story Engine：先建立故事，再设计镜头
- 在不违背用户要求时，为故事寻找自然的局面变化；若用户明确要求平静、纪实、无反转，则不要强加转折。
- 在写 beats 前，先明确 protagonist、externalWant、internalNeed、stakes、obstacle、finalChoice、consequence、change 和 storyAnchor。它们必须贯穿全片，不能只是装饰字段。
- 每个角色必须有「想要的东西（want）」和「挡着他的东西（obstacle）」，这是戏剧性的根。
- 每个 beat 必须是因果动作：cause 引发 conflict，角色作出 choice，产生 consequence；consequence 或 nextCause 必须推动下一 beat。
- 每个 beat 必须有一个可见、可表演的 dramaticPurpose。禁止只写“人物站着、看着、慢慢走、镜头缓缓移动”而没有局面变化。
- 情绪弧线：起点情绪必须不同于终点情绪（如从压抑→释然，从疏离→靠近）。
- 台词必须有潜台词（subtext）：嘴上说的 ≠ 心里想的，不直说。
- 台词必须克制：用户没有明确要求对白、旁白或口播时，默认用动作和表情讲故事，speech 写 []。只有信息无法用画面表达或用户明确提供台词时才写台词。
- 不得为了“电影感”添加旁白、画外音、路人说话、感叹词、笑声、哼唱或无来源的人声。用户给出的指定台词必须逐字保留，不改写、不扩写。
- speech 是全片唯一权威台词源。每个 beat 最多一条；speaker 必须在当前 characters 中；exactLine 只能包含角色真正说出口的逐字内容，绝不能填写“无人说话”“无其他角色在场”“其他角色沉默/闭嘴/无声反应”等导演指令。其他角色状态只写进 action 或 state，不得放进 speech。
- audioPlan 是唯一权威声音源。backgroundHuman 默认 none；只有剧情明确需要人群存在感时才可用 indistinct_nonverbal，且绝不能产生可辨识词语。环境、拟音、音乐必须分层，未要求音乐时 music 写 none。
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
- 按 clipType 控制节奏：insert 2-4秒；reaction/establishing 3-6秒；action 4-7秒；dialogue/performance 5-8秒；montage 2-4秒；long_take 10-15秒。没有叙事理由不要用 long_take。

🎬 镜头/节奏要求
- 全片必须严格输出 ${targetShots} 个 beats，不多不少；这是制作规格，不是建议。
- 写 beats 前先在内部给 sequences 分配镜头额度，各 sequence 的 beats 数相加必须等于 ${targetShots}。
- 目标总片长约 ${targetSeconds} 秒。各镜头 durationHint 仍按内容推导，但全片 durationHint 总和应尽量接近该片长。
- beats 是【因果链】，不是并列画面：前一个 beat 导致后一个 beat。
- 每个 beat 只描述一个明确动作单元。
- 大多数 beat 应无台词；有台词的 beat 每镜最多一句、只允许当前 characters 中的一个已命名角色说话。禁止多人同时说、重复上一镜台词或添加临时说话者。
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
  "title": "片名",
  "theme": "一句话主题（谁 + 想得到什么 + 阻碍是什么）",
  "logline": "一句话梗概",
  "protagonist": "主角名",
  "externalWant": "主角表面想得到的具体目标",
  "internalNeed": "主角真正需要学会或承认的东西",
  "stakes": "失败会失去什么",
  "obstacle": "持续阻碍主角的核心力量",
  "finalChoice": "高潮处主角必须做出的选择",
  "consequence": "这个选择造成的可见结果",
  "change": "主角从开场到结尾的变化",
  "storyAnchor": "贯穿全片并在关键转折回响的故事锚点",
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
          "clipType": "insert|reaction|establishing|action|dialogue|performance|montage|long_take",
          "dramaticPurpose": "本镜头必须改变什么信息、关系或决定",
          "cause": "导致本镜头发生的直接原因",
          "conflict": "本镜头中的阻力或两难",
          "choice": "角色做出的可见选择；没有则写空字符串",
          "consequence": "选择/动作产生的可见结果",
          "characterChange": "本镜头前后角色认知或情绪变化",
          "nextCause": "推动下一镜头的直接原因",
          "speech": [ { "character": "角色名", "exactLine": "只填写角色真正说出口的唯一短句", "emotion": "克制的具体情绪", "delivery": "语速、停顿、重音", "volume": "whisper|soft|normal|raised", "lipSync": true, "source": "user_exact|story_required" } ],
          "audioPlan": { "backgroundHuman": "none|indistinct_nonverbal", "environment": ["明确环境声"], "foley": ["由可见动作触发的拟音"], "music": "none 或用户明确要求的音乐", "silenceBefore": 0.8, "silenceAfter": 0.8 },
          "stateBefore": { "characters": "人物位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "关系状态", "emotion": "情绪状态" },
          "stateAfter": { "characters": "人物位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "关系状态", "emotion": "情绪状态" },
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
- 除非发生明确时空跳转，前一 beat 的 stateAfter 必须与后一 beat 的 stateBefore 一致；不能让人物、道具、关系或情绪无原因复位。
- source="user_exact" 时 exactLine 必须能在用户原始输入中逐字找到；否则只能写 story_required。绝不输出 narrator、voice-over、路人或当前 characters 之外的 speaker。
- transition：默认 "cut"；情绪切换或时间跳转可用 "dissolve"/"fade"。
- characters/objects 数组为空时写 []。
- sceneStyle：不要只写“cinematic lighting”或情绪形容词。用紧凑英文确定本 sequence 的拍摄基线：一种相机/镜头家族、主光来源与方向/软硬/色温、环境反射或负补光、有限曝光与高光滚降、阴影密度、色彩响应和主要材质。相邻 sequence 若时空连续必须继承同一成像系统。
- promptDraft：已上传角色用 [名称](2-3 个外观关键词) 格式；临时角色/物体直接描述。动作之后简要写出独特机位距离、前中后景、焦点平面和光线入射关系；不要堆 cinematic、8K、masterpiece、photorealistic 等空泛词。
- cameraMove 必须是单一、可执行的物理运镜，不要把多个方向堆在一起；sceneStyle、promptDraft、audioPlan.environment、audioPlan.foley 和非 none 的 audioPlan.music 必须使用英文，只有 action、剧情字段和台词按项目语言输出。
- 最终自检 sequences[].beats 的总数必须严格等于 ${targetShots}，beat.index 必须为 1–${targetShots}。

现在请开始，把这个梗概戏剧化成一个完整、有电影感的故事结构。`;
}
