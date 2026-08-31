import { NextRequest, NextResponse } from 'next/server';
import { downloadStoryboardImage } from '@/lib/storyboardImageSource';
import { fitStoryboardProxyImage } from '@/lib/storyboardImageProxyServer';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    const image = await downloadStoryboardImage(request.nextUrl.searchParams.get('url') || '');
    const bytes = await fitStoryboardProxyImage(image.bytes);
    return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '分镜图读取失败' }, { status: 502 });
  }
}
