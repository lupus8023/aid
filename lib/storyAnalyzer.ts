import { chatCompletion } from './apimart';
import { Storyboard, Character, ObjectItem } from '@/types';

// 分析故事并生成分镜
export async function analyzeStory(
  storyContent: string,
  characters: Character[],
  apiKey: string,
  objects: ObjectItem[] = [],
  aspectRatio: '16:9' | '9:16' = '16:9'
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
你是一位资深的电影分镜师和视觉导演。请深度分析以下故事内容,将其拆解成专业的分镜场景。

🚨 核心规则 - 名称精确匹配 🚨
═══════════════════════════════════════════════════════════════
1. 你必须先理解故事中的角色和物体
2. 然后将它们映射到用户上传的角色和物体名称
3. 在分镜的 characters 和 objects 字段中，只能使用用户上传的精确名称
4. 绝对不允许自己创造、推断或修改任何名称
5. 如果故事中的角色/物体在上传列表中找不到对应，则不要包含在该分镜中
6. 🎭 保持台词一致性：如果原文中有对话或台词，必须在场景描述中完整保留，不得改写或省略
⚠️ 特别注意：物体与角色同等重要，必须准确识别和使用

═══════════════════════════════════════════════════════════════
📋 用户上传的角色列表（这是唯一允许使用的角色名称）
═══════════════════════════════════════════════════════════════
${characterDetails}

✅ 允许使用的角色名称: ${characterNames}
❌ 禁止: 使用任何不在上述列表中的角色名称

═══════════════════════════════════════════════════════════════
🎯 用户上传的物体列表（这是唯一允许使用的物体名称）
═══════════════════════════════════════════════════════════════
${objectDetails}

${objects.length > 0 ? `✅ 允许使用的物体名称: ${objectNames}
❌ 禁止: 使用任何不在上述列表中的物体名称
❌ 禁止: 根据故事内容推断或创造新的物体名称
⚠️ 如果场景需要的物体不在上述列表中，该场景的 objects 字段必须为空数组 []

🔍 物体识别重点：
- 仔细阅读每个物体的描述，理解其外观特征和用途
- 识别故事中明确提到或暗示的物体
- 考虑物体在场景中的作用（展示、使用、交互等）
- 注意物体上的文字、logo、图案等关键识别特征
⚠️ 术语说明：mask = 面膜 (facial mask/beauty mask)，不是口罩 (medical mask)。除非特别说明，否则mask指护肤美容产品。

🚨 物体识别的关键规则：
1. 如果故事中提到角色"拿着"、"使用"、"展示"某物 → 必须检查物体列表并包含
2. 如果故事描述了产品、道具、物品 → 必须尝试映射到物体列表
3. 物体可能以不同方式被提及（如"产品"、"盒子"、"面膜"等）→ 需要理解语义并映射
4. 即使故事中没有明确提到物体名称，但描述了该物体的特征 → 也要识别并包含
5. 物体在场景中的重要性与角色同等 → 不要遗漏物体

❌ 常见错误（必须避免）：
- 错误：故事提到"产品"，但没有将其映射到物体列表中的具体产品名称
- 正确：识别"产品"指的是物体列表中的哪个具体物体，并使用精确名称
- 错误：只在角色直接接触物体时才包含物体
- 正确：只要物体在场景中可见或相关，就应该包含` : `⚠️ 用户未上传任何物体，所有场景的 objects 字段必须为空数组 []`}

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
3. 只有能够精确映射的角色/物体才能出现在分镜中
4. 无法映射的角色/物体不要包含在分镜中

示例映射过程：
- 故事中提到"模特" → 检查角色列表 → 如果有"模特"，使用"模特"
- 故事中提到"金膜产品盒" → 检查物体列表 → 如果有"金膜产品盒"，使用"金膜产品盒"
- 故事中提到"小狗" → 检查角色列表 → 如果没有"小狗"，该场景不包含此角色


═══════════════════════════════════════════════════════════════
🎬 分镜设计要求
═══════════════════════════════════════════════════════════════

作为专业分镜师,你需要：

1. **深度理解剧本**
   - 分析故事的情节发展、情感曲线、戏剧冲突
   - 识别关键转折点和情感高潮
   - 理解每个场景在整体叙事中的作用

2. **角色导向设计**
   - 根据角色性格特点设计动作和表情
   - 考虑角色之间的关系和互动
   - 通过镜头语言展现角色的内心状态

3. **专业镜头语言**
   - 景别选择：特写(close-up)、中景(medium shot)、全景(wide shot)等
   - 镜头角度：平视、仰视、俯视、侧面等
   - 构图原则：三分法、对称、引导线、景深等
   - 视觉重心：主体位置、视线方向、动作方向

4. **情绪与氛围**
   - 通过光影、空间、角色姿态传达情绪
   - 营造场景的氛围感和张力
   - 考虑节奏：静态 vs 动态、紧张 vs 舒缓

═══════════════════════════════════════════════════════════════
📝 输出格式（只输出 JSON，不要其他内容）
═══════════════════════════════════════════════════════════════
[
  {
    "sceneNumber": 1,
    "description": "场景描述（中文）：详细描述镜头内容、角色状态、环境氛围、情绪表达",
    "characters": ["角色名"],  // ⚠️ 必须使用用户上传的精确角色名称
    "objects": ["物体名"],     // ⚠️ 必须使用用户上传的精确物体名称，如无则为 []
    "prompt": "Professional cinematic image prompt in English",
    "videoPrompt": "Professional cinematic video motion prompt in English describing camera movement, subject motion, and atmosphere",
    "characterCostume": { "角色名": "Detailed costume description: clothing, hair, accessories, colors" },
    "sceneStyle": "Scene environment and lighting style description in English"
  }
]

🚨 关键要求 - characters 和 objects 字段：
1. characters 数组中的每个名称必须完全匹配用户上传的角色名称
2. objects 数组中的每个名称必须完全匹配用户上传的物体名称
3. 不允许出现任何用户未上传的名称
4. 名称必须完全一致，包括大小写、空格、标点符号
5. 如果场景中没有角色或物体，使用空数组 []

═══════════════════════════════════════════════════════════════
✅ Prompt 编写规范（极其重要 — 直接决定图像生成质量）
═══════════════════════════════════════════════════════════════

🚨 核心原则：prompt 会被发送给图像生成模型，模型需要通过文字理解"谁是谁"。
因此，每次提到角色或物体时，必须同时包含：
1. 方括号标记的名称 [Name]（用于系统匹配参考图）
2. 简短的外观描述（用于图像模型理解视觉特征）

格式：[角色名](外观关键词) 动作描述
示例：[BABADA](young woman with long black hair, wearing white dress) standing in the center

每个 prompt 必须包含：

1. **镜头设定** (Shot Setup)
   - 景别：close-up / medium shot / full body shot / wide shot
   - 角度：eye-level / low angle / high angle / dutch angle
   - 构图：centered / rule of thirds / leading lines

2. **角色表现** (Character Performance)
   - 格式：[角色名](从角色描述中提取的2-3个关键外观特征) + 动作/表情
   - 具体动作：running / jumping / reaching / turning
   - 表情情绪：determined / joyful / worried / surprised
   - 肢体语言：arms raised / crouching / leaning forward

3. **物体描述** (Object Description)
   - 格式：[物体名](从物体描述中提取的关键外观特征) + 位置/状态
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
📌 示例 Prompt（注意每个角色/物体都带有外观描述）
═══════════════════════════════════════════════════════════════

示例 1 - 只有角色：
"Medium shot, eye-level angle. [BABADA](young woman, long black hair, white summer dress) standing in the center, arms crossed, determined expression, looking directly forward. Forest environment with dappled sunlight filtering through trees. Shallow depth of field."

示例 2 - 角色和物体：
"Close-up shot, slightly low angle. [模特](Asian female model, sleek ponytail, minimal makeup) holding [金膜产品盒](golden luxury skincare box with Chinese text logo) in both hands, gentle smile, looking at the product. The product box positioned in the foreground with clear visibility of text and logo. Soft studio lighting, white background."

示例 3 - 多个角色和物体：
"Wide shot, eye-level angle. [BABADA](young woman, long black hair, white dress) on the left reaching toward [玩具车](red toy car, plastic, palm-sized), [FAFADA](young man, short brown hair, blue jacket) on the right watching with curious expression. The toy car in the center of the table. Warm indoor lighting, cozy living room."

🚨 关键提醒：
- 每次提到角色/物体，必须使用 [名称](外观描述) 格式
- 外观描述从用户提供的角色/物体描述中提取最关键的2-4个视觉特征
- 这些内联描述帮助图像模型理解参考图中的主体是什么样的

现在请开始分析故事并生成专业分镜。分镜数量：5-15个，根据故事复杂度决定。
`;

  try {
    const response = await chatCompletion(prompt, apiKey);

    // 提取 JSON 内容
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse storyboard JSON from AI response');
    }

    const storyboards: Storyboard[] = JSON.parse(jsonMatch[0]);

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
