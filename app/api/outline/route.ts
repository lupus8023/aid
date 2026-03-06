import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/apimart';
import { Character, ObjectItem } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { storyContent, characters, objects } = await request.json();

    if (!storyContent || !characters || characters.length === 0) {
      return NextResponse.json(
        { error: 'Story content and characters are required' },
        { status: 400 }
      );
    }

    const characterNames = characters.map((c: Character) => c.name).join('、');
    const characterDetails = characters.map((c: Character) =>
      `- ${c.name}: ${c.description}`
    ).join('\n');

    const objectNames = objects?.map((o: ObjectItem) => o.name).join('、') || '无';
    const objectDetails = objects && objects.length > 0
      ? objects.map((o: ObjectItem) => `- ${o.name}: ${o.description}`).join('\n')
      : '无';

    const prompt = `
你是一个专业的编剧。请分析以下故事内容，生成一个清晰的剧目大纲。

🚨 核心规则 - 严格使用上传的角色和物体 🚨
═══════════════════════════════════════════════════════════════
1. 只能使用用户上传的角色，不允许创造新角色
2. 只能使用用户上传的物体，不允许创造新物体
3. 在大纲中提到角色时，必须用方括号 [] 标记，例如：[FAFADA]
4. 在大纲中提到物体时，必须用方括号 [] 标记，例如：[金膜产品盒]
5. 如果故事需要其他角色或物体，请在现有角色和物体范围内调整故事
6. 绝对禁止出现"追逐者X"、"守护者Y"等虚构角色

═══════════════════════════════════════════════════════════════
📋 用户上传的角色列表（唯一允许使用的角色）
═══════════════════════════════════════════════════════════════
${characterDetails}

✅ 允许使用的角色名称: ${characterNames}
⚠️ 在大纲中提到角色时，必须使用 [角色名] 格式标记
❌ 禁止: 创造任何新角色或使用不在列表中的角色名称

═══════════════════════════════════════════════════════════════
🎯 用户上传的物体列表（唯一允许使用的物体）
═══════════════════════════════════════════════════════════════
${objectDetails}

${objects && objects.length > 0 ? `✅ 允许使用的物体名称: ${objectNames}
⚠️ 在大纲中提到物体时，必须使用 [物体名] 格式标记
❌ 禁止: 创造任何新物体或使用不在列表中的物体名称` : '⚠️ 用户未上传任何物体'}

═══════════════════════════════════════════════════════════════
📖 故事内容
═══════════════════════════════════════════════════════════════
${storyContent}

═══════════════════════════════════════════════════════════════
📝 输出要求
═══════════════════════════════════════════════════════════════
请生成一个结构化的剧目大纲，包括：
1. 故事主题
2. 主要角色介绍（只介绍上传的角色，角色名用 [角色名] 标记）
3. 故事梗概（分段描述，角色用 [角色名] 标记，物体用 [物体名] 标记）
4. 关键情节点（角色用 [角色名] 标记，物体用 [物体名] 标记）

示例格式：
- "在一片神秘的森林中，[FAFADA]用他独特的方式发现了美丽与自我接受的重要性"
- "[FAFADA]拿着[金膜产品盒]走进房间"
- "[BABADA]看到[玩具车]后露出笑容"
- "[FAFADA]和[BABADA]一起玩[玩具车]"

请用清晰的中文输出，格式友好易读。
`;

    const outline = await chatCompletion(prompt);

    return NextResponse.json({ outline });
  } catch (error) {
    console.error('Outline API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate outline' },
      { status: 500 }
    );
  }
}
