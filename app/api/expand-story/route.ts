import { NextRequest } from 'next/server';
import { chatCompletion } from '@/lib/apimart';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { brief, language, apiKey, scriptModel } = await request.json();
  if (!brief || !apiKey) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const langInstruction = language === 'en'
    ? 'Write the full script in English.'
    : '用中文写完整剧本。';

  const prompt = `你是一位专业编剧。用户提供了一个故事方向或简介，请将其扩写成一个完整的、适合拍摄的剧本。

要求：
- 包含完整的场景描述、角色动作和对话台词
- 结构清晰，有开头、发展、高潮、结尾
- 台词自然生动，符合角色性格
- 长度适中（500-1500字）
- ${langInstruction}

用户输入：
${brief}

请直接输出剧本内容，不需要任何解释或前言。`;

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const pingInterval = setInterval(async () => {
    try { await writer.write(encoder.encode(': ping\n\n')); } catch {}
  }, 5000);

  (async () => {
    try {
      const script = await chatCompletion(prompt, apiKey, scriptModel || 'gpt-4o-mini');
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
