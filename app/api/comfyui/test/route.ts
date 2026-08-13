import { NextRequest, NextResponse } from 'next/server';
import { testComfyUIConnection } from '@/lib/comfyui';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { settings = {} } = await request.json();
    return NextResponse.json(await testComfyUIConnection(settings));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'ComfyUI 连接测试失败' },
      { status: 500 },
    );
  }
}
