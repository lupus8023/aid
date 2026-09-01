import { NextRequest, NextResponse } from 'next/server';
import { auditImageAppearance } from '@/lib/series/imageAppearanceAudit';
import { streamingJsonResponse } from '@/lib/streamingJsonResponse';
import { normalizeImageStyleReference } from '@/lib/imageStyleReference';
export const maxDuration = 120;
export async function POST(request: NextRequest) {
  try {
    const { imageUrl, apiKey, dmxApiKey, scriptProvider, scriptModel, styleReference, description } = await request.json();
    if (typeof imageUrl !== 'string' || !imageUrl || (!apiKey && !dmxApiKey)) throw new Error('质感核验需要素材地址和现有模型设置');
    const context = {styleReference:normalizeImageStyleReference(styleReference),description:typeof description === 'string' ? description : undefined};
    return streamingJsonResponse(async () => ({ ...await auditImageAppearance(imageUrl, { apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel }, context) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '质感核验失败' }, { status: 400 });
  }
}
