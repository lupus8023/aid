import { NextRequest, NextResponse } from 'next/server';
import { analyzeStory } from '@/lib/storyAnalyzer';
import { Character } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { storyContent, characters, objects, aspectRatio, apiKey, language } = await request.json();

    if (!storyContent || !characters || characters.length === 0) {
      return NextResponse.json(
        { error: 'Story content and characters are required' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key is required' },
        { status: 400 }
      );
    }

    // 调用故事分析函数
    const storyboards = await analyzeStory(storyContent, characters, apiKey, objects || [], aspectRatio, language || 'zh');

    return NextResponse.json({ storyboards });
  } catch (error) {
    console.error('Analyze API error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze story' },
      { status: 500 }
    );
  }
}
