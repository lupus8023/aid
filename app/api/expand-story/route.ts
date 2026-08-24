import { NextRequest } from 'next/server';
import { chatOnce } from '@/lib/pipeline/llm';
import { buildStoryAdaptationCorrection, buildStoryAdaptationPrompt, validateAdaptedStoryScript } from '@/lib/pipeline/storyAdaptationPrompt';
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
      let script = '';
      let validation = validateAdaptedStoryScript('', normalizedShotCount);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const correction = attempt === 1 ? '' : buildStoryAdaptationCorrection(validation.errors);
        script = await chatOnce(`${prompt}${correction}`, {
          apiKey,
          dmxApiKey,
          provider: scriptProvider,
          model: scriptModel || 'gpt-4o-mini',
          maxOutputTokens: Math.min(16_000, 3_000 + normalizedShotCount * 140),
          timeoutMs: process.env.AID_LOCAL_COMPANION === '1' ? 150_000 : 48_000,
        });
        validation = validateAdaptedStoryScript(script, normalizedShotCount);
        if (validation.valid) break;
        console.warn(`[story-adaptation] attempt ${attempt}/3 failed production validation: ${validation.errors.join('; ')}`);
      }
      if (!validation.valid) {
        throw new Error(`改编稿连续 3 次未满足视频 JSON 规格：${validation.errors.slice(0, 4).join('；')}`);
      }
      await writer.write(encoder.encode(`data: ${JSON.stringify({ script, productionReady: true })}\n\n`));
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
