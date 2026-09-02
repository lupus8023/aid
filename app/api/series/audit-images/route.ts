import { NextRequest, NextResponse } from 'next/server';
import { auditImageCast } from '@/lib/series/imageCastAudit';
import { streamingJsonResponse } from '@/lib/streamingJsonResponse';
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  try {
    const { boards, characters, objects, apiKey, dmxApiKey, scriptProvider, scriptModel } = await request.json();
    if (!Array.isArray(boards) || boards.length < 1 || boards.length > 3 || !Array.isArray(characters) || !Array.isArray(objects || [])) throw new Error('每批核验1–3张分镜及其身份参考');
    if (!apiKey && !dmxApiKey) throw new Error('角色核验需要已有的模型API设置');
    return streamingJsonResponse(async () => ({ checks: await Promise.all(boards.map(board => auditImageCast(board, characters, { apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel }, { objects: objects || [] }))) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '分镜角色核验失败' }, { status: 400 });
  }
}
