import { chatCompletion } from '@/lib/apimart';

async function parseProviderResponse(response: Response, provider: string): Promise<any> {
  const body = await response.text();
  let data: any;
  try {
    data = body.trim() ? JSON.parse(body) : undefined;
  } catch {
    const isHtml = String(response.headers.get('content-type') || '').includes('text/html')
      || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body);
    throw new Error(isHtml
      ? `${provider} returned an HTML gateway page (HTTP ${response.status}); the upstream request may have timed out`
      : `${provider} returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`${provider} error: ${message}`);
  }
  return data;
}

async function dmxChatCompletion(prompt: string, apiKey: string, model: string, timeoutMs: number): Promise<string> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('https://www.dmxapi.cn/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const data = await parseProviderResponse(response, 'DMXAPI');
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('DMXAPI response did not contain message content');
      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // A full 120-second timeout is unlikely to benefit from an immediate
      // retry, while short network/gateway failures often do.
      if (attempt === 0 && !/timeout|timed out/i.test(lastError.message)) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      break;
    }
  }
  throw lastError || new Error('DMXAPI request failed');
}

// 统一的 LLM 调用入口：优先 dmxApiKey，失败自动回退 apimart（反之亦然）。
// 单一 provider 网络故障时不至于让脚本生成整体失败。
export async function chatOnce(
  prompt: string,
  opts: { apiKey: string; dmxApiKey?: string; model?: string },
): Promise<string> {
  const { apiKey, dmxApiKey, model = 'gpt-4o' } = opts;
  const errors: Error[] = [];
  const isLocalCompanion = process.env.AID_LOCAL_COMPANION === '1';
  // Netlify ends synchronous and streamed functions at 60 seconds. Keep hosted
  // failures inside that window so the route can still return JSON; Companion
  // has no such platform limit and can wait for long-form model output.
  const providerTimeout = isLocalCompanion
    ? 240000
    : apiKey && dmxApiKey
      ? 24000
      : 50000;

  if (dmxApiKey) {
    try {
      return await dmxChatCompletion(prompt, dmxApiKey, model, providerTimeout);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (apiKey) {
    try {
      return await chatCompletion(prompt, apiKey, model, providerTimeout);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  const last = errors[errors.length - 1];
  throw last || new Error('No LLM API key configured');
}
