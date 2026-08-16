import { chatCompletion } from '@/lib/apimart';

async function dmxChatCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://www.dmxapi.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`DMXAPI error: ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Unexpected DMXAPI response: ${JSON.stringify(data)}`);
  return content;
}

// 统一的 LLM 调用入口：优先 dmxApiKey，失败自动回退 apimart（反之亦然）。
// 单一 provider 网络故障时不至于让脚本生成整体失败。
export async function chatOnce(
  prompt: string,
  opts: { apiKey: string; dmxApiKey?: string; model?: string },
): Promise<string> {
  const { apiKey, dmxApiKey, model = 'gpt-4o' } = opts;
  const errors: Error[] = [];

  if (dmxApiKey) {
    try {
      return await dmxChatCompletion(prompt, dmxApiKey, model);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (apiKey) {
    try {
      return await chatCompletion(prompt, apiKey, model);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  const last = errors[errors.length - 1];
  throw last || new Error('No LLM API key configured');
}
