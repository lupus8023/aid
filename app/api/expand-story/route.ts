import { NextRequest } from 'next/server';
import { chatCompletion } from '@/lib/apimart';

export const maxDuration = 300;

async function dmxChatCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://www.dmxapi.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!response.ok) throw new Error(`DMXAPI error: ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Unexpected DMXAPI response`);
  return content;
}

export async function POST(request: NextRequest) {
  const { brief, language, apiKey, scriptModel, dmxApiKey } = await request.json();
  if (!brief || (!apiKey && !dmxApiKey)) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const langInstruction = language === 'en' ? 'Write the full script in English.' : '用中文写完整剧本。';

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
      const script = dmxApiKey
        ? await dmxChatCompletion(prompt, dmxApiKey, scriptModel || 'gpt-4o-mini')
        : await chatCompletion(prompt, apiKey, scriptModel || 'gpt-4o-mini');
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
