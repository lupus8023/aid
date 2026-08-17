import { NextRequest, NextResponse } from 'next/server';
import { generateStoryPlan } from '@/lib/pipeline/storyWriter';

export const maxDuration = 300;

// 编剧阶段：梗概 + 角色/道具 → 结构化 StoryPlan（主题/欲望/冲突/转折/潜台词/母题 + 分场 beats + 时长）
export async function POST(request: NextRequest) {
  try {
    const {
      synopsis, characters, objects, apiKey, language, scriptModel, dmxApiKey, targetShotCount,
    } = await request.json();

    if (!synopsis?.trim()) {
      return NextResponse.json({ error: 'synopsis is required' }, { status: 400 });
    }
    if (!characters?.length) {
      return NextResponse.json({ error: 'characters are required' }, { status: 400 });
    }
    if (!apiKey && !dmxApiKey) {
      return NextResponse.json({ error: 'apiKey or dmxApiKey is required' }, { status: 400 });
    }

    const storyPlan = await generateStoryPlan({
      synopsis: synopsis.trim(),
      characters: characters || [],
      objects: objects || [],
      apiKey,
      language: language || 'zh',
      scriptModel,
      dmxApiKey,
      targetShotCount,
    });

    return NextResponse.json({ storyPlan });
  } catch (error: any) {
    console.error('generate-story-plan error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate story plan' },
      { status: 500 }
    );
  }
}
