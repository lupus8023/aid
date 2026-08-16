import { chatCompletion } from '@/lib/apimart';

// 统一的 LLM 调用入口：优先 dmxApiKey，否则走 apimart chatCompletion。
export async function chatOnce(
  prompt: string,
  opts: { apiKey: string; dmxApiKey?: string; model?: string },
): Promise<string> {
  const { apiKey, dmxApiKey, model = 'gpt-4o' } = opts;

  if (dmxApiKey) {
    const response = await fetch('https://www.dmxapi.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${dmxApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] })
    });
    if (!response.ok) throw new Error(`DMXAPI error: ${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Unexpected DMXAPI response: ${JSON.stringify(data)}`);
    return content;
  }

  return chatCompletion(prompt, apiKey, model);
}
