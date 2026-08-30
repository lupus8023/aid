import { NextRequest, NextResponse } from 'next/server';
import { createMediaUploadTickets } from '@/lib/cloudinaryUpload';

// Same access boundary as /api/upload-image. Only sign allowlisted media
// folders, disallow overwrite, and never return the account secret.
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    if (body.length > 2000) return NextResponse.json({ error: '签名参数过长' }, { status: 413 });
    const { folder, resource_type, public_id } = JSON.parse(body);
    return NextResponse.json({ targets: createMediaUploadTickets({ folder, resource_type, public_id }) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '无法准备媒体保存通道' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
