import { NextRequest, NextResponse } from 'next/server';
import { getTaskStatus } from '@/lib/apimart';

export async function POST(request: NextRequest) {
  try {
    const { taskId, apiKey } = await request.json();

    if (!taskId || !apiKey) {
      return NextResponse.json(
        { error: 'taskId and apiKey are required' },
        { status: 400 }
      );
    }

    const status = await getTaskStatus(taskId, apiKey);

    if (status.status === 'completed' && status.result?.images?.[0]?.url) {
      const imageUrl = status.result.images[0].url;
      const finalUrl = Array.isArray(imageUrl) ? imageUrl[0] : imageUrl;
      return NextResponse.json({ status: 'completed', imageUrl: finalUrl });
    }

    if (status.status === 'failed') {
      return NextResponse.json({ status: 'failed' });
    }

    return NextResponse.json({ status: status.status || 'pending' });
  } catch (error) {
    console.error('Check image status error:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}
