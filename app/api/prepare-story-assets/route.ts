import { NextRequest, NextResponse } from 'next/server';
import { streamingJsonResponse } from '@/lib/streamingJsonResponse';
import { understandVisualAssets, type VisualAssetInput } from '@/lib/pipeline/visualAssets';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1024 * 1024) return NextResponse.json({ error: '原图理解请求过大，请先上传参考图' }, { status: 413 });
    const { assets, apiKey, dmxApiKey, scriptProvider, scriptModel } = JSON.parse(raw);
    if (!apiKey && !dmxApiKey) return NextResponse.json({ error: '请先配置文本模型 API' }, { status: 400 });
    if (!Array.isArray(assets) || assets.length > 64 || new Set(assets.map(a => a?.id)).size !== assets.length) return NextResponse.json({ error: '资产列表无效' }, { status: 400 });
    for (const asset of assets) {
      const url = new URL(asset.imageUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !asset.id || !asset.name || !asset.sourceKey || !['character', 'object'].includes(asset.kind) || typeof asset.description !== 'string') return NextResponse.json({ error: '需要已上传的原图、名称和用途说明' }, { status: 400 });
    }
    return streamingJsonResponse(async () => ({ identities: await understandVisualAssets(assets as VisualAssetInput[], { apiKey, dmxApiKey, scriptProvider, scriptModel }) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '原图理解失败' }, { status: 400 });
  }
}
