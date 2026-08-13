import { NextRequest, NextResponse } from 'next/server';
import { downloadComfyUIOutput, getComfyUIVideoStatus, isComfyUITask } from '@/lib/comfyui';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { taskId, comfyui = {} } = await request.json();
    if (!taskId || !isComfyUITask(taskId)) {
      return NextResponse.json({ error: '有效的 ComfyUI Task ID 是必填项' }, { status: 400 });
    }

    const status = await getComfyUIVideoStatus(taskId, comfyui);
    if (status.status === 'failed') {
      return NextResponse.json({ error: status.error || 'ComfyUI 任务执行失败' }, { status: 409 });
    }
    if (status.status !== 'completed' || !status.output) {
      return NextResponse.json({ error: '视频仍在生成中', status: status.status }, { status: 409 });
    }

    const buffer = await downloadComfyUIOutput(taskId, status.output, comfyui);
    const promptId = taskId.replace(/^comfyui(?:-long)?:/, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'minimax-h3';
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${promptId}.mp4"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('ComfyUI local download error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ComfyUI 视频下载失败' },
      { status: 500 },
    );
  }
}
