import { NextRequest, NextResponse } from 'next/server';
import { createVideoTask } from '@/lib/apimart';

export async function POST(request: NextRequest) {
  try {
    const { prompt, imageUrl, apiKey } = await request.json();

    if (!prompt || !apiKey) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const taskId = await createVideoTask(
      prompt,
      imageUrl ? [imageUrl] : [],
      apiKey,
      'doubao-seedance-2.0',
      '16:9'
    );

    return NextResponse.json({
      success: true,
      taskId,
      message: 'Doubao Seedance 2.0 任务已创建'
    });
  } catch (error) {
    console.error('Test doubao error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '测试失败' },
      { status: 500 }
    );
  }
}
