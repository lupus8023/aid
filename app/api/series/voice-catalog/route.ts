import { NextResponse } from 'next/server';
import { listFishCatalog } from '@/lib/series/fishCatalog';
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    const { fishAudioKey, ...query } = await request.json();
    if (!fishAudioKey || typeof fishAudioKey !== 'string') throw new Error('请先在设置中配置 Fish API Key');
    return NextResponse.json(await listFishCatalog(fishAudioKey, query), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Fish 音色库读取失败' }, { status: 400 });
  }
}
