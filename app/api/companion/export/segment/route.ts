import { NextRequest, NextResponse } from 'next/server';
import { persistExportSegment } from '@/lib/companionVideoExportServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (process.env.AID_LOCAL_COMPANION !== '1') {
    return NextResponse.json({ error: '该接口仅供本机 Companion 使用' }, { status: 404 });
  }
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') || '';
    const clipId = request.nextUrl.searchParams.get('clipId') || '';
    const sha256 = request.nextUrl.searchParams.get('sha256') || '';
    const result = await persistExportSegment(request, projectId, clipId, sha256);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '保存片段失败' }, { status: 400 });
  }
}
