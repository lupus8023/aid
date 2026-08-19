import { NextRequest, NextResponse } from 'next/server';
import { exportDownloadInfo, exportFileStream } from '@/lib/companionVideoExportServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function downloadName(value: string): string {
  const clean = String(value || 'AID-Story.mp4').replace(/[\r\n"\\/]+/g, '-').slice(0, 180);
  return clean.toLowerCase().endsWith('.mp4') ? clean : `${clean}.mp4`;
}

export async function GET(request: NextRequest) {
  if (process.env.AID_LOCAL_COMPANION !== '1') {
    return NextResponse.json({ error: '该接口仅供本机 Companion 使用' }, { status: 404 });
  }
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') || '';
    const jobId = request.nextUrl.searchParams.get('jobId') || '';
    const { job, filePath, size } = await exportDownloadInfo(projectId, jobId);
    const fileName = downloadName(job.outputName);
    return new NextResponse(exportFileStream(filePath), {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(size),
        'Content-Disposition': `attachment; filename="AID-Story.mp4"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '下载成片失败' }, { status: 404 });
  }
}
