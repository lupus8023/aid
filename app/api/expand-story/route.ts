import { NextRequest } from 'next/server';
import { chatOnce } from '@/lib/pipeline/llm';
import { buildStoryAdaptationPrompt } from '@/lib/pipeline/storyAdaptationPrompt';
import { normalizeTargetShotCount } from '@/lib/pipeline/shotCount';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { brief, language, targetShotCount, apiKey, scriptProvider, scriptModel, dmxApiKey } = await request.json();
  if (!brief || (!apiKey && !dmxApiKey)) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const normalizedShotCount = normalizeTargetShotCount(targetShotCount);
  const prompt = buildStoryAdaptationPrompt({
    brief,
    language: language === 'en' ? 'en' : 'zh',
    targetShotCount: normalizedShotCount,
  });

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const pingInterval = setInterval(async () => {
    try { await writer.write(encoder.encode(': ping\n\n')); } catch {}
  }, 5000);

  (async () => {
    try {
      const script = await chatOnce(prompt, {
        apiKey,
        dmxApiKey,
        provider: scriptProvider,
        model: scriptModel || 'gpt-4o-mini',
        maxOutputTokens: Math.min(16_000, 3_000 + normalizedShotCount * 140),
        timeoutMs: process.env.AID_LOCAL_COMPANION === '1' ? 150_000 : 48_000,
      });
      await writer.write(encoder.encode(`data: ${JSON.stringify({ script })}\n\n`));
    } catch (error) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Failed' })}\n\n`));
    } finally {
      clearInterval(pingInterval);
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
