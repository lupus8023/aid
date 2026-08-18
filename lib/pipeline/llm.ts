import axios from 'axios';
import { chatCompletion } from '@/lib/apimart';
import { providerHttpsAgent } from '@/lib/publicDns';
import { scriptProviderOrder, type ScriptProvider } from './scriptProvider';

export { scriptProviderOrder } from './scriptProvider';
export type { ScriptProvider } from './scriptProvider';

function parseProviderPayload(payload: any, status: number, contentType: string, provider: string): any {
  let data = payload;
  if (typeof payload === 'string') {
    try {
      data = payload.trim() ? JSON.parse(payload) : undefined;
    } catch {
      const isHtml = contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(payload);
      throw new Error(isHtml
        ? `${provider} 返回了 HTML 网关页（HTTP ${status}），上游请求可能已超时`
        : `${provider} 返回了无效 JSON（HTTP ${status}）`);
    }
  }
  if (status < 200 || status >= 300) {
    const message = data?.error?.message || data?.error || data?.message || `HTTP ${status}`;
    throw new Error(`${provider} 错误：${message}`);
  }
  return data;
}

async function dmxChatCompletion(prompt: string, apiKey: string, model: string, timeoutMs: number): Promise<string> {
  try {
    const response = await axios.post('https://www.dmxapi.cn/v1/chat/completions', {
      model,
      stream: false,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      httpsAgent: providerHttpsAgent(),
      timeout: timeoutMs,
      validateStatus: () => true,
      transformResponse: value => value,
    });
    const data = parseProviderPayload(
      response.data,
      response.status,
      String(response.headers['content-type'] || '').toLowerCase(),
      'DMXAPI',
    );
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('DMXAPI 响应中没有 message content');
    return content;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error('[story-llm] DMXAPI failed:', normalized.message);
    throw normalized;
  }
}

export async function chatOnce(
  prompt: string,
  opts: { apiKey?: string; dmxApiKey?: string; provider?: ScriptProvider; model?: string },
): Promise<string> {
  const { apiKey = '', dmxApiKey = '', provider = 'auto', model = 'gpt-4o' } = opts;
  if (provider === 'dmx' && !dmxApiKey) throw new Error('剧本 API 选择了 DMX，但尚未配置 DMXAPI Key');
  if (provider === 'apimart' && !apiKey) throw new Error('剧本 API 选择了 APIMart，但尚未配置 APIMart API Key');

  const order = scriptProviderOrder(provider, Boolean(dmxApiKey), Boolean(apiKey));
  if (!order.length) throw new Error('没有可用的剧本 API Key');

  const isLocalCompanion = process.env.AID_LOCAL_COMPANION === '1';
  // Hosted functions have a hard 60-second ceiling. The Companion can allow
  // long-form planning requests to finish without a gateway replacing JSON.
  const providerTimeout = isLocalCompanion ? 240_000 : order.length > 1 ? 24_000 : 50_000;
  const errors: string[] = [];

  for (const candidate of order) {
    try {
      if (candidate === 'dmx') return await dmxChatCompletion(prompt, dmxApiKey, model, providerTimeout);
      return await chatCompletion(prompt, apiKey, model, providerTimeout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const label = candidate === 'dmx' ? 'DMXAPI' : 'APIMart';
      console.error(`[story-llm] ${label} failed:`, message);
      errors.push(`${label}：${message}`);
    }
  }

  throw new Error(errors.join('；') || '剧本 API 请求失败');
}
