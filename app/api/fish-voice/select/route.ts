import { NextRequest, NextResponse } from 'next/server';
import { discoverFishVoice } from '@/lib/fishVoiceDiscovery';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { fishAudioKey, character, language = 'zh' } = await request.json();
    if (!fishAudioKey) return NextResponse.json({ error: '请先在设置中配置 Fish Audio API Key' }, { status: 400 });
    if (!character?.name?.trim()) return NextResponse.json({ error: '角色名称不能为空' }, { status: 400 });
    const selection = await discoverFishVoice({
      ...character,
      name: character.name.trim(),
      language: language === 'en' ? 'en' : 'zh',
    }, fishAudioKey);
    return NextResponse.json(selection);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Fish Audio 自动选声失败' }, { status: 500 });
  }
}
