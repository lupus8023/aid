import { chatCompletion } from './apimart';
import { Storyboard, Character, ObjectItem } from '@/types';

async function dmxChatCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://www.dmxapi.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) throw new Error(`DMXAPI error: ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Unexpected DMXAPI response: ${JSON.stringify(data)}`);
  return content;
}

// 分析故事并生成分镜
export async function analyzeStory(
  storyContent: string,
  characters: Character[],
  apiKey: string,
  objects: ObjectItem[] = [],
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
  language: 'zh' | 'en' = 'zh',
  scriptModel: string = 'gpt-4o-mini',
  dmxApiKey?: string
): Promise<Storyboard[]> {
  const characterNames = characters.map(c => c.name).join('、');

  // 构建角色详细信息
  const characterDetails = characters.map(c =>
    `- ${c.name}: ${c.description}`
  ).join('\n');

  // 构建物体详细信息(如果有)
  const objectNames = objects.map(o => o.name).join('、');
  const objectDetails = objects.length > 0 ? objects.map(o =>
    `- ${o.name}: ${o.description}`
  ).join('\n') : '无';

  const prompt = `
你是一位资深的电影导演和分镜师。你的任务是将剧本忠实地拆解成分镜，而不是重新创作。

🎯 最高原则：分镜为剧本服务
- 每个分镜必须对应剧本中的具体段落
- 不得添加剧本中没有的情节、台词或角色行为
- 不得省略剧本中的关键台词和动作
- 如果剧本有明确的场景描述，必须忠实还原

🌐 输出语言要求（强制执行）：
${language === 'en'
  ? '⚠️ MANDATORY: ALL text output MUST be in ENGLISH. This includes description, dialogueLines[].text, characterCostume values, sceneStyle. NO Chinese characters allowed in any field except character/object names.'
  : '⚠️ 强制要求：所有文本输出必须使用中文，包括 description、dialogueLines[].text、characterCostume 的值、sceneStyle。除角色/物体名称外，不允许出现英文句子。'}

🚨 核心规则 - 名称精确匹配 🚨
═══════════════════════════════════════════════════════════════
1. 你必须先理解故事中的角色和物体
2. 然后将它们映射到用户上传的角色和物体名称
3. 在分镜的 characters 和 objects 字段中，只能使用用户上传的精确名称
4. 绝对不允许自己创造、推断或修改任何名称
5. 🎭 保持台词一致性：如果原文中有对话或台词，必须在场景描述中完整保留，不得改写或省略

⚠️ 临时角色与物体规则（重要）：
- characters 和 objects 字段：只包含用户上传的角色和物体（用于匹配参考图）
- prompt 和 description 中：必须描述脚本中出现的所有角色和物体，包括用户未上传的
- 示例：如果脚本提到"一条鱼在水中游"，但用户没有上传"鱼"：
  · characters 数组为空或只包含用户上传的角色（如["人物A"]）
  · 但 prompt 中必须描述"a fish swimming in the water"
  · description 中必须描述"一条鱼在水中游动"
- 常见临时角色：动物、路人、背景人物、幻想生物等
- 常见临时物体：自然元素（树、石、水）、日常物品（椅、桌、灯）等

⚠️ 特别注意：物体与角色同等重要，必须准确识别和使用

═══════════════════════════════════════════════════════════════
📋 用户上传的角色列表（这是唯一允许使用的角色名称）
═══════════════════════════════════════════════════════════════
${characterDetails}

✅ 允许使用的角色名称: ${characterNames}
❌ 禁止: 使用任何不在上述列表中的角色名称

═══════════════════════════════════════════════════════════════
🎯 用户上传的物体列表（这些是唯一能匹配参考图的物体名称）
═══════════════════════════════════════════════════════════════
${objectDetails}

${objects.length > 0 ? `✅ 已上传物体（有参考图）: ${objectNames}
这些物体必须在 objects 数组中，以便系统匹配参考图` : '⚠️ 用户未上传任何物体'}

❌ 禁止：在 objects 数组中使用任何不在上述列表中的物体名称
❌ 禁止：根据故事内容创造新的物体名称并放入 objects 数组

⚠️ 临时物体规则（重要）：
- objects 数组：只包含用户上传的物体（用于匹配参考图）
- prompt 和 description 中：必须描述脚本中出现的所有物体，包括用户未上传的
- 示例：如果脚本提到"一条鱼在水中游"，但用户没有上传"鱼"：
  · objects 数组为空或只包含用户上传的物体
  · 但 prompt 中必须描述"a fish swimming in the water"
  · description 中必须描述"一条鱼在水中游动"
- 常见临时物体：自然元素（树、石、水、天空）、日常物品（椅、桌、灯、门）、食物、动物等

🔍 已上传物体的识别重点：
- 仔细阅读每个物体的描述，理解其外观特征和用途
- 识别故事中明确提到或暗示的已上传物体
- 考虑物体在场景中的作用（展示、使用、交互等）
- 注意物体上的文字、logo、图案等关键识别特征
⚠️ 术语说明：mask = 面膜 (facial mask/beauty mask)，不是口罩 (medical mask)。除非特别说明，否则mask指护肤美容产品。

🚨 已上传物体的识别规则：
1. 如果故事中提到角色"拿着"、"使用"、"展示"某物，且该物在已上传列表中 → 必须在 objects 数组中包含
2. 如果故事描述了产品、道具、物品，且该物在已上传列表中 → 必须映射到物体列表
3. 物体可能以不同方式被提及（如"产品"、"盒子"、"面膜"等）→ 需要理解语义并映射
4. 即使故事中没有明确提到物体名称，但描述了该物体的特征 → 也要识别并包含
5. 物体在场景中的重要性与角色同等 → 不要遗漏已上传的物体

❌ 常见错误（必须避免）：
- 错误：故事提到"产品"，且物体列表中有该产品，但没有将其映射到具体产品名称
- 正确：识别"产品"指的是物体列表中的哪个具体物体，并使用精确名称
- 错误：只在角色直接接触物体时才包含物体
- 正确：只要物体在场景中可见或相关，就应该包含

═══════════════════════════════════════════════════════════════
📖 故事内容
═══════════════════════════════════════════════════════════════
${storyContent}

═══════════════════════════════════════════════════════════════
🔍 名称映射步骤（必须执行）
═══════════════════════════════════════════════════════════════
在生成分镜之前，你必须：
1. 识别故事中提到的所有角色和物体
2. 将它们映射到用户上传的名称列表
3. 分为两类：
   · 已映射：用户上传了参考图的角色/物体 → 加入 characters/objects 数组
   · 未映射：脚本中提到但用户未上传的 → 只在 prompt/description 中描述
4. 所有角色和物体都必须在 prompt/description 中描述，无论是否上传了参考图

示例映射过程：
- 故事中提到"模特" → 检查角色列表 → 如果有"模特"，加入 characters 数组
- 故事中提到"金膜产品盒" → 检查物体列表 → 如果有"金膜产品盒"，加入 objects 数组
- 故事中提到"一条鱼" → 检查角色/物体列表 → 如果没有"鱼"：
  · 不加入 characters/objects 数组
  · 但必须在 prompt 中描述"a fish"或"a swimming fish"
  · 在 description 中必须描述"一条鱼"


═══════════════════════════════════════════════════════════════
🎬 分镜设计要求
═══════════════════════════════════════════════════════════════

作为专业分镜师,你需要：

1. **景别多样化（强制要求）**
   每组镜头必须包含不同景别，形成视觉节奏变化：
   - 极远景(ELS)：主体渺小，展示宏大环境
   - 远景(LS)：主体全身可见，头到脚完整呈现
   - 中远景(MLS)：膝盖以上，展示姿态与环境关系
   - 中景(MS)：腰部以上，3/4侧面，展示表情与动作
   - 近景(MCU)：胸部以上，突出表情与情绪
   - 特写(CU)：面部或物体正面，强调细节
   - 大特写(ECU)：眼睛/手/产品细节，极致放大
   - 低角度仰拍：向上拍摄，强调权威感/英雄感
   - 过肩镜头：对话场景，展示主观视角
   禁止连续使用相同景别，相邻镜头景别必须有明显变化。

2. **台词分配规则（强制要求）**
   - 剧本中的每句台词必须分配到对应镜头的 dialogueLines 中
   - **每个镜头最多只有一句台词，且只能由一个角色说出**
   - **禁止一个镜头内出现多角色对话或多人台词**
   - 如果一个场景有多句台词或多角色对话，必须拆分成多个镜头
   - 有台词的镜头，台词必须完整出现在 dialogueLines 中，不得省略
   - 无台词的镜头，dialogueLines 为空数组
   - ⚠️ 台词时长限制（关键规则）：
     * 按正常语速计算：中文约4.5字/秒，英文约2.5词/秒
     * 目标朗读时长：4秒左右（3.5～4.5秒）。有台词必须写够，禁止生成短句
     * 中文：单句台词 16～20字（16字≈3.5秒，20字≈4.5秒）
     * 英文：单句台词 10～12词（10词≈4秒，12词≈4.8秒）
   - ⚠️ 优先无台词镜头：大多数镜头应为无台词的动作/环境镜头，只有关键对话才需要台词

3. **角色导向设计**
   - 根据角色性格特点设计动作和表情
   - 考虑角色之间的关系和互动
   - 通过镜头语言展现角色的内心状态

4. **情绪与氛围**
   - 通过光影、空间、角色姿态传达情绪
   - 营造场景的氛围感和张力
   - 考虑节奏：静态 vs 动态、紧张 vs 舒缓

5. **镜头间动作连贯性（强制要求）**
   - 相邻镜头之间，角色的位置、朝向、动作必须有自然的延续
   - 避免角色在相邻镜头中出现突兀的位置跳跃（如从左到右瞬间切换到从右到左）
   - 如果一个动作跨多个镜头，每个镜头必须描述动作的连续阶段（如：起步→推进→收尾）
   - 角色的服装、发型、道具在相邻镜头描述中必须完全一致
   - 景别切换必须有逻辑：如从中景推进到特写，或从特写拉远到全景，而非随机跳切
   - 时间/空间逻辑一致：白天镜头后不应接黑夜，室内不应突然变室外

6. **一镜一动作原则（强制要求）**
   - 每个镜头只能描述一个明确的动作单元
   - 如果动作可以拆分为多个阶段，必须拆分为多个镜头
   - 禁止在单个镜头中堆砌多个不相关的动作
   - 示例：
     ❌ 错误：角色走进房间，坐下，打开电脑
     ✅ 正确：镜头1 - 走进房间；镜头2 - 坐下；镜头3 - 打开电脑
   - 每个镜头的 description 应该聚焦于"一个主体 + 一个动作 + 一个环境"

7. **明确的视觉焦点（强制要求）**
   - 每个镜头必须有明确的视觉主体或焦点
   - 特写镜头：焦点是面部表情、手部动作、产品细节
   - 中景镜头：焦点是人物上半身动作、人物互动
   - 全景镜头：焦点是人物站位、环境关系、空间布局
   - 禁止：缺乏焦点的"全景式罗列"（例如："角色A坐在椅子上，旁边有桌子，墙上有画，窗外有树"）
   - 示例：
     ✅ 正确："[特写] 角色A的手紧紧握住杯子，指节发白，镜头聚焦在手的紧张感上"
     ❌ 错误："[中景] 角色A坐在椅子上，旁边有桌子，墙上有画"（缺乏焦点）

8. **景别节奏模式（推荐）**
   - 模式 A：渐进式 — 全景建立场景 → 中景 → 近景 → 特写 → 大特写强调情绪
   - 模式 B：跳跃式 — 中景 ↔ 特写交替，制造视觉节奏和张力
   - 模式 C：沉浸式（连续特写） — 全景开场，中段连续 3-5 个特写聚焦细节动作，结尾回到中景展示完整结果
   - 示例（沉浸式）：
     · 镜头1：全景 — 咖啡店开门，建立场景
     · 镜头2-6：连续特写 — 倒豆子、压粉、萃取、打奶泡、拉花（聚焦制作过程细节）
     · 镜头7：中景 — 推杯子给顾客
     · 镜头8：中景 — 顾客满意微笑（情绪回报）
   - 禁止：连续 3 个以上相同景别（除非有意营造重复效果）
   - 禁止：所有镜头都用同一景别（缺乏视觉节奏）

9. **情绪回报要求（强制要求）**
   - 最后一个镜头（或最后两个镜头）必须展示情绪回报或结果展示
   - 情绪回报示例：
     · 角色微笑、点头、拥抱、击掌
     · 顾客满意、观众欢呼、任务完成
     · 产品展示、成果揭晓、问题解决
   - 禁止：动作做到一半就结束，没有收尾
   - 禁止：最后一个镜头是"中间过程"，没有展示结果或情绪
   - 示例：
     ✅ 正确：镜头8 - "顾客喝了一口，脸上露出满意的笑容，竖起大拇指"
     ❌ 错误：镜头8 - "顾客端起杯子"（动作未完成，没有情绪回报）

10. **动作链设计（强制要求）**
    - 跨镜头的动作必须拆解为多个镜头，展示完整过程
    - 每个镜头描述动作的一个阶段，不要跳过中间环节
    - 确保相邻镜头之间存在时间上的连续性
    - 示例：
      ✅ 正确：
      · 镜头1：角色A举起手，准备敲门
      · 镜头2：手落下，指节叩击门板
      · 镜头3：门缓缓打开，角色B出现
      → 这是一个完整的"敲门"动作链
      ❌ 错误：
      · 镜头1：角色A敲门
      · 镜头2：角色B坐在沙发上
      → 缺少中间的"门打开"动作，不连贯
    - 如果动作涉及物体互动，必须展示"接触 → 互动 → 结果"的完整过程

11. **运镜与视频提示词设计（电影级标准）**

   核心原则：
   - 时间轴分段：每段标注时间范围和镜头编号，如 [00–03s] Shot 1: (Interior / Close-up)
   - 每段聚焦一个核心动作，不堆砌多个事件
   - 动作分解：不写"角色走路"，写"feet plant → body leans → coat billows → stride completes"
   - 微表情细节：subtle nod、eyes narrow、jaw tightens、breathing lightly、tears gathering in lower eyelid
   - 环境互动：rain lashes windshield、water sprays into lens、motion blur stretches lights
   - 多层音效（具体化）：rain patter + engine roar + tire screech，不只写"环境音"
   - 连贯性结尾：seamless transition / no cut / smooth camera movement

   🎬 **媒介自适应质感要求**（关键）：
   - **先识别参考图媒介**：真人实拍 / 3D CG / 动漫 / 插画 / 定格；全程保持同一种视觉语言，禁止跨媒介漂移
   - **真人实拍**：natural skin texture, stable facial anatomy, believable biomechanics, NO excessive smoothing, NO plastic skin
   - **CG / 动漫 / 插画**：保持原始轮廓、比例、线条、材质、着色与动画语言；禁止强加毛孔、摄影皮肤或真人化五官
   - **泪水物理效果**：tears gathering in eyes → moisture reflects light → single tear slowly rolls down cheek → clear tear track visible on skin surface, wet eyelashes
   - **微表情时间轴**（人物特写必备）：
     * 0-5s: eyes downcast, suppressing emotion, reddening eyes, moisture beginning to appear
     * 6-10s: slowly lifting gaze toward camera, eyes glistening with tears gathering in lower eyelid
     * 11-15s: single tear falls only when the story requires it; otherwise resolve the requested action naturally
   - **光线的电影级控制**：
     * 主光源方向：left side cool moonlight / right side warm candlelight / backlit rim light
     * 光线性格：soft and delicate / dramatic and contrasty / restrained and melancholic
     * 光影细节：eye catchlight, cheek highlights, subtle contour shadows
   - **镜头语言专业化**：
     * 85mm cinema lens / macro lens effect / extreme shallow DOF (f/1.4-f/2.8)
     * slow push-in with slight handheld breathing feel
     * background completely blurred with soft bokeh
     * face sharp and detailed in foreground
   - **表演匹配题材与角色**：
     * quiet and suppressed, NOT exaggerated crying or shouting
     * lips gently closed, breathing very light
     * 情绪强度由剧情决定，不要默认所有角色哭泣或悲伤
     * 真人使用自然微表情；风格化角色保持其既有表演与形变语言

   运镜类型：
   - Push in / Pull out / Pan left/right / Tracking shot / Dolly in / Slow push-in
   - Static shot / Handheld breathing / Orbital shot / Low angle / Over-shoulder / POV / FPV
   - Macro close-up / Extreme close-up (eyes/hands/product details)

   videoPrompt 格式（必须遵守）：

   [00–Xs] Shot N: (景别 / 角度 / 镜头规格)
   场景描述。角色动作分解（micro-expression + body movement + realistic skin details）。环境互动细节。光影效果（light direction + character + color temperature）。真实物理细节（tear physics / cloth simulation / breathing rhythm）。SFX: 音效1 + 音效2 + 音效3。

   [Xs–Ys] Shot N+1: (景别 / 角度 / 镜头规格)
   动作延续或转折。情绪变化细节（eyes/expression/posture）。物理效果（fluid dynamics / natural motion）。质感（motion blur, shallow DOF, skin texture）。SFX: 音效变化。

   MOOD: 情绪关键词（restrained / melancholic / tense / joyful）
   STYLE: 视觉风格（Cinematic realism / Period drama / Commercial / Editorial portrait）
   LIGHTING: 光线设置（left cool moonlight + right warm candlelight / natural window light / dramatic side light）
   QUALITY: preserve source medium, stable identity and anatomy, coherent physics, cinema-grade finish, no flicker, no morphing, no medium drift; for live action only: natural skin texture, no plastic skin or beauty filter

   示例 1 - 动作场景：
   "[00–05s] Shot 1: (Interior / Close-up / 85mm f/2.0)
   Rain lashes the windshield. The driver (in helmet) looks over, calm and focused. Dashboard lights reflect on his visor. He gives a subtle nod and mouths 'Let's go.' SFX: rain patter + engine idle + visor tap.

   [05–10s] Shot 2: (Wide action / Tracking shot)
   Both cars accelerate in sync on wet asphalt. Water sprays into the camera lens. Motion blur stretches stadium lights into long color streaks. SFX: tire screech + engine roar + crowd cheer.

   MOOD: High-stakes tension
   STYLE: Hollywood cinematic realism
   LIGHTING: Stadium floodlights + wet asphalt reflections
   QUALITY: 4K Ultra HD, cinematic texture, stable face, no deformation, smooth transitions"

   示例 2 - 情绪特写（电影级真实感）：
   "[00–05s] Shot 1: (Extreme close-up / Fixed frame / 85mm f/1.4)
   Ancient Chinese woman in her 20s, classical hair bun with jade hairpin, pale blue silk collar. Eyes downcast, suppressing emotion, eye rims slowly reddening, moisture beginning to gather. Realistic skin texture with visible pores and fine facial hair. Soft left-side cool moonlight illuminates eyes and cheeks. Background completely blurred with wooden lattice window bokeh. SFX: gentle breathing + distant wind chimes.

   [05–10s] Shot 2: (Extreme close-up / Slow push-in / 85mm f/1.4 macro)
   She slowly lifts her gaze toward camera, eyes glistening with broken sadness. Tears gathering in lower eyelid, eyelashes becoming wet with moisture, eye catchlight reflecting moonlight. Lips gently closed, breathing very light. Natural makeup with subtle blush on eye corners. Right side has faint warm candlelight creating rim light on cheek contour. SFX: barely audible breathing + fabric rustle.

   [10–15s] Shot 3: (Extreme close-up / Fixed with handheld breathing / 85mm f/1.4 macro)
   Single tear slowly falls from right eye, rolls down cheek naturally along skin texture, tear track clearly visible with moisture reflecting light. Wet eyelashes detailed and sharp. Face remains composed but eyes convey restrained heartbreak. Camera holds on her sorrowful yet controlled expression. Real tear physics, skin pores and fine hair clearly visible. SFX: silent moment + distant guqin note.

   MOOD: Restrained melancholy, quiet heartbreak, suppressed emotion
   STYLE: Chinese period drama, cinematic portrait realism, editorial aesthetic
   LIGHTING: Left cool moonlight (main light on eyes/cheeks) + right warm candlelight (subtle rim light)
   QUALITY: 8K ultra-clear, realistic skin texture with visible pores and fine facial hair, cinema-grade color grading, real portrait photography feel, HDR, realistic tear physics with natural flow and reflection, NO plastic skin, NO beauty filter smoothing, natural imperfections preserved"

═══════════════════════════════════════════════════════════════
📝 输出格式（只输出 JSON，不要其他内容）
═══════════════════════════════════════════════════════════════
[
  {
    "sceneNumber": 1,
    "description": "镜头设计（中文）：[景别 + 角度] 主体动作 + 环境细节 + 情绪氛围。必须包含：景别（远景/全景/中景/近景/特写）、机位角度（平视/仰拍/俯拍）、运镜方式（推/拉/摇/移/跟/静止）、物理细节（布料/水流/光影）",
    "characters": ["角色名"],
    "objects": ["物体名"],
    "prompt": "Professional cinematic image prompt in English",
    "videoPrompt": "TIMELINE-based Seedance 2.0 video prompt with camera movements, physics, and SFX",
    "locationId": "unique_location_key",
    "characterCostume": { "角色名": "Detailed costume description: clothing, hair, accessories, colors" },
    "sceneStyle": "Scene environment and lighting style description in English",
    "dialogueLines": [
      { "character": "角色名", "text": "台词原文，按说话先后顺序排列" }
    ]
  }
]

⚠️ description 关键要求（镜头语言）：
- 必须以景别开头：[远景/全景/中景/近景/特写/大特写]
- 必须标注角度：平视/低角度仰拍/俯拍/过肩/FPV
- 必须包含运镜：推镜/拉镜/摇镜/跟镜/升降/静止/手持
- 必须描述物理细节：布料飘动/水花飞溅/光影变化/自然动作
- 示例："[中景，低角度仰拍] 角色A缓步走向镜头，风吹动衣摆，阳光从侧面打来形成轮廓光。推镜逐渐靠近面部，表情坚定。真实布料物理，自然步态。"

⚠️ dialogueLines 关键规则：
- 顺序必须与故事中实际说话的先后顺序完全一致
- prompt 中提到角色时，也必须按照说话先后顺序排列
- 如果剧本中有台词，必须完整保留在对应的分镜中，不得遗漏

⚠️ locationId 规则：同一地点的所有镜头必须使用相同的 locationId（英文小写下划线，如 gold_mine、office、street）

🚨 关键要求 - characters 和 objects 字段：
1. characters 数组中的每个名称必须完全匹配用户上传的角色名称
2. objects 数组中的每个名称必须完全匹配用户上传的物体名称
3. 不允许出现任何用户未上传的名称
4. 名称必须完全一致，包括大小写、空格、标点符号
5. 如果场景中没有用户上传的角色或物体，使用空数组 []
6. ⚠️ 重要：脚本中提到的临时角色（如动物、路人、幻想生物）和临时物体（如自然元素、日常物品）不在 characters/objects 数组中，但必须在 prompt/description 中描述

═══════════════════════════════════════════════════════════════
✅ Prompt 编写规范（极其重要 — 直接决定图像生成质量）
═══════════════════════════════════════════════════════════════

🚨 核心原则：prompt 会被发送给图像生成模型，模型需要通过文字理解"谁是谁"。
因此，每次提到角色或物体时，必须同时包含：
1. 方括号标记的名称 [Name]（用于系统匹配参考图）
2. 简短的外观描述（用于图像模型理解视觉特征）

格式：[角色名](外观关键词) 动作描述
示例：[BABADA](young woman with long black hair, wearing white dress) standing in the center

⚠️ 临时角色和物体的处理：
- 已上传参考图的角色/物体：使用 [名称](外观描述) 格式
- 未上传参考图的临时角色/物体：直接描述，不需要方括号
- 临时角色示例："a colorful fish swimming", "a black cat", "a passerby in the background"
- 临时物体示例："a wooden chair", "sunlight streaming through window", "ripples on water"

每个 prompt 必须包含：

1. **镜头设定** (Shot Setup)
   - 景别：close-up / medium shot / full body shot / wide shot
   - 角度：eye-level / low angle / high angle / dutch angle
   - 构图：centered / rule of thirds / leading lines

2. **角色表现** (Character Performance)
   - 已上传角色格式：[角色名](从角色描述中提取的2-3个关键外观特征) + 动作/表情
   - 临时角色格式：直接描述，如 "a colorful fish swimming gracefully"
   - 具体动作：running / jumping / reaching / turning
   - 表情情绪：determined / joyful / worried / surprised
   - 肢体语言：arms raised / crouching / leaning forward

3. **物体描述** (Object Description)
   - 已上传物体格式：[物体名](从物体描述中提取的关键外观特征) + 位置/状态
   - 临时物体格式：直接描述，如 "a wooden table in the center"
   - 物体位置：on the table / in hand / in background
   - 物体状态：opened / closed / glowing

4. **环境与氛围** (Environment & Atmosphere)
   - 场景描述：forest / city street / indoor room / open field
   - 光影效果：dramatic lighting / soft light / backlit / rim light
   - 氛围感：tense / peaceful / mysterious / energetic

5. **视觉细节** (Visual Details)
   - 景深效果：shallow depth of field / deep focus
   - 动态元素：flowing / floating / swirling

⚠️ 禁止事项：
- 不要包含艺术风格词汇（anime / cartoon / Studio Ghibli / realistic 等）
- 不要包含色彩风格描述（vibrant colors / pastel / monochrome 等）
- 视觉风格将由参考图片自动决定

═══════════════════════════════════════════════════════════════
📌 示例 Prompt（注意区分已上传和临时角色/物体）
═══════════════════════════════════════════════════════════════

示例 1 - 只有已上传角色：
"Medium shot, eye-level angle. [BABADA](young woman, long black hair, white summer dress) standing in the center, arms crossed, determined expression, looking directly forward. Forest environment with dappled sunlight filtering through trees. Shallow depth of field."

示例 2 - 已上传角色和物体：
"Close-up shot, slightly low angle. [模特](Asian female model, sleek ponytail, minimal makeup) holding [金膜产品盒](golden luxury skincare box with Chinese text logo) in both hands, gentle smile, looking at the product. The product box positioned in the foreground with clear visibility of text and logo. Soft studio lighting, white background."

示例 3 - 已上传角色 + 临时角色（关键示例）：
"Medium shot, eye-level angle. [BABADA](young woman, long black hair, white dress) standing by a river, watching a colorful fish swimming gracefully in the clear water. The fish has vibrant orange and white scales, fins fluttering. Sunlight filters through trees, creating dappled light on the water surface. Peaceful atmosphere."
→ 注意：BABADA 是已上传角色，用 [BABADA](...) 格式
→ 注意：鱼是临时角色（用户未上传），直接描述 "a colorful fish"

示例 4 - 多个已上传角色 + 临时物体：
"Wide shot, eye-level angle. [BABADA](young woman, long black hair, white dress) on the left reaching toward [玩具车](red toy car, plastic, palm-sized), [FAFADA](young man, short brown hair, blue jacket) on the right watching. A wooden table sits in the center, sunlight streaming through a window in the background. Warm indoor lighting, cozy living room."

🚨 关键提醒：
- 已上传角色/物体：使用 [名称](外观描述) 格式，外观描述从用户提供的内容提取
- 临时角色/物体：直接描述，不需要方括号，描述要足够具体以便图像模型理解
- characters/objects 数组：只包含已上传的角色/物体
- prompt 中：必须描述所有角色和物体，包括临时的

现在请开始分析故事并生成专业分镜。分镜数量：最多9个，根据故事复杂度决定，尽量精简。
`;

  try {
    const response = dmxApiKey
      ? await dmxChatCompletion(prompt, dmxApiKey, scriptModel)
      : await chatCompletion(prompt, apiKey, scriptModel);

    // 提取 JSON 内容
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse storyboard JSON from AI response');
    }

    const storyboards: Storyboard[] = JSON.parse(jsonMatch[0]).slice(0, 9);

    // 添加 ID 和状态
    return storyboards.map((sb, index) => ({
      ...sb,
      id: `scene-${index + 1}`,
      status: 'pending' as const,
      aspectRatio
    }));
  } catch (error) {
    console.error('Story analysis error:', error);
    throw new Error('Failed to analyze story');
  }
}
