import { NextRequest, NextResponse } from 'next/server';
import { createOrResumeExportJob } from '@/lib/companionVideoExportServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (process.env.AID_LOCAL_COMPANION !== '1') {
    return NextResponse.json({ error: '该接口仅供本机 Companion 使用' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const job = await createOrResumeExportJob(body.projectId, body.clips, body.outputName, body.aspectRatio);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '创建导出任务失败' }, { status: 400 });
  }
}
