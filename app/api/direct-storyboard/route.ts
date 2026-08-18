import { NextRequest, NextResponse } from 'next/server';
import { directStoryboard } from '@/lib/pipeline/storyDirector';

export const maxDuration = 300;

// 导演阶段：StoryPlan → 有序分镜（Storyboard[]），无镜头数量上限。
export async function POST(request: NextRequest) {
  try {
    const {
      storyPlan, characters, objects, apiKey, aspectRatio, language, scriptProvider, scriptModel, dmxApiKey,
    } = await request.json();

    if (!storyPlan?.sequences) {
      return NextResponse.json({ error: 'storyPlan is required' }, { status: 400 });
    }
    if (!characters?.length) {
      return NextResponse.json({ error: 'characters are required' }, { status: 400 });
    }
    if (!apiKey && !dmxApiKey) {
      return NextResponse.json({ error: 'apiKey or dmxApiKey is required' }, { status: 400 });
    }

    const storyboards = await directStoryboard({
      storyPlan,
      characters: characters || [],
      objects: objects || [],
      apiKey,
      aspectRatio: aspectRatio || '16:9',
      language: language || 'zh',
      scriptProvider,
      scriptModel,
      dmxApiKey,
    });

    return NextResponse.json({ storyboards });
  } catch (error: any) {
    console.error('direct-storyboard error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to direct storyboard' },
      { status: 500 }
    );
  }
}
