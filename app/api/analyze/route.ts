import { NextRequest } from 'next/server';
import { analyzeStory } from '@/lib/storyAnalyzer';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { storyContent, characters, objects, aspectRatio, apiKey, language, scriptModel } = await request.json();

  if (!storyContent || !characters || characters.length === 0 || !apiKey) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Keep-alive ping every 5s to prevent timeout
  const pingInterval = setInterval(async () => {
    try { await writer.write(encoder.encode(': ping\n\n')); } catch {}
  }, 5000);

  (async () => {
    try {
      const storyboards = await analyzeStory(storyContent, characters, apiKey, objects || [], aspectRatio, language || 'zh', scriptModel || 'gpt-4o-mini');
      await writer.write(encoder.encode(`data: ${JSON.stringify({ storyboards })}\n\n`));
    } catch (error) {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to analyze story' })}\n\n`));
    } finally {
      clearInterval(pingInterval);
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
