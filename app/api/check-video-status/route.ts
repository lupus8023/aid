import { NextRequest, NextResponse } from 'next/server';
import { getVideoTaskStatus } from '@/lib/apimart';

export async function POST(request: NextRequest) {
  try {
    const { taskId, apiKey } = await request.json();

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    console.log('Checking video task status:', taskId);

    // 查询视频任务状态
    const status = await getVideoTaskStatus(taskId, apiKey);
    console.log('Video task status:', status.status);

    // 返回状态信息
    const response: any = {
      taskId,
      status: status.status,
    };

    // 如果完成，返回视频 URL
    if (status.status === 'completed' && status.result?.videos?.[0]?.url) {
      response.videoUrl = status.result.videos[0].url;
      console.log('Video completed, URL:', response.videoUrl);
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Check video status API error:', error);
    console.error('Error message:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to check video status' },
      { status: 500 }
    );
  }
}
