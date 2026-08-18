import { NextRequest } from 'next/server';
import { chatOnce } from '@/lib/pipeline/llm';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { brief, language, apiKey, scriptModel, dmxApiKey } = await request.json();
  if (!brief || (!apiKey && !dmxApiKey)) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const langInstruction = language === 'en' ? 'Write the full script in English.' : '用中文写完整剧本。';

  const prompt = `你是一位专业编剧，擅长为AI视频短片编写可视化剧本。用户提供了一个故事方向或简介，请将其扩写成一个完整的、适合拍摄成视频短片的剧本。

要求：
- 包含完整的场景描述和角色动作；用户未明确要求对白、旁白或口播时，优先用动作和表情叙事，不主动添加台词
- 结构清晰，有开头、发展、高潮、结尾
- 用户给出的指定台词逐字保留，不改写、不扩写；确有必要新增的台词必须自然、符合角色性格且简短（中文≤20字，英文≤12词）
- 不添加画外音、路人说话、感叹词、笑声、哼唱或无来源的人声
- 动作描写必须具体可视化：使用可见的身体动作、表情、环境互动，不写抽象心理描写（如"感到悲伤"要写成"肩膀下垂，眼眶泛红"）
- 每个场景聚焦一个核心动作，不堆砌多个事件
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
      const script = await chatOnce(prompt, {
        apiKey,
        dmxApiKey,
        model: scriptModel || 'gpt-4o-mini',
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
