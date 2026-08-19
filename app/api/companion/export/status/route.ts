import { NextRequest, NextResponse } from 'next/server';
import { recoverExportJob } from '@/lib/companionVideoExportServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (process.env.AID_LOCAL_COMPANION !== '1') {
    return NextResponse.json({ error: '该接口仅供本机 Companion 使用' }, { status: 404 });
  }
  const projectId = request.nextUrl.searchParams.get('projectId') || '';
  const jobId = request.nextUrl.searchParams.get('jobId') || '';
  if (!projectId || !jobId) return NextResponse.json({ error: '缺少导出任务标识' }, { status: 400 });
  const job = await recoverExportJob(projectId, jobId);
  if (!job) return NextResponse.json({ error: '未找到导出任务' }, { status: 404 });
  return NextResponse.json({ ok: true, job });
}
