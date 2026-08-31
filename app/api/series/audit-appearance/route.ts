import { NextRequest, NextResponse } from 'next/server';
import { auditImageAppearance } from '@/lib/series/imageAppearanceAudit';
import { streamingJsonResponse } from '@/lib/streamingJsonResponse';
export const maxDuration = 120;
export async function POST(request: NextRequest) {
  try {
    const { imageUrl, apiKey, dmxApiKey, scriptProvider, scriptModel } = await request.json();
    if (typeof imageUrl !== 'string' || !imageUrl || (!apiKey && !dmxApiKey)) throw new Error('质感核验需要素材地址和现有模型设置');
    return streamingJsonResponse(async () => ({ ...await auditImageAppearance(imageUrl, { apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel }) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '质感核验失败' }, { status: 400 });
  }
}
