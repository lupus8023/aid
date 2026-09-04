import axios from 'axios';
import { chatCompletionResult } from '@/lib/apimart';
import { providerHttpsAgent } from '@/lib/publicDns';
import { scriptProviderOrder, type ScriptProvider } from './scriptProvider';
import { assertProviderAccepted, chatInputContent, responsesInput, isProviderContentRejection, extractProviderText, isResponsesPreferredModel, providerPayloadSummary, providerResponseMetadata, type ProviderTextResult } from './providerPayload';

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
  assertProviderAccepted(data, { provider, status: String(status) });
  if (status < 200 || status >= 300) {
    const message = data?.error?.message || data?.error || data?.message || `HTTP ${status}`;
    throw new Error(`${provider} 错误：${message}`);
  }
  return data;
}

async function requestDmxText(
  endpoint: 'chat/completions' | 'responses',
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number,
): Promise<ProviderTextResult> {
  const response = await axios.post(`https://www.dmxapi.cn/v1/${endpoint}`, body, {
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
    if (data?.error) {
      throw new Error(`DMXAPI 错误：${data.error?.message || data.error?.code || '未知上游错误'}`);
    }
    const metadata = providerResponseMetadata(data, { provider: 'dmx', endpoint, model: String(body.model || ''), maxOutputTokens: Number(body.max_output_tokens || body.max_completion_tokens || body.max_tokens) });
    assertProviderAccepted(data, metadata);
    const content = extractProviderText(data);
    if (!content) {
      const finishReason = data?.choices?.[0]?.finish_reason;
      const detail = finishReason === 'length'
        ? '模型在输出最终 JSON 前已达到 token 上限'
        : data?.choices?.[0]?.message?.refusal
          ? `模型拒绝了请求：${data.choices[0].message.refusal}`
          : '响应中没有可用的最终文本';
      throw new Error(`${detail}（${endpoint}；结构 ${providerPayloadSummary(data)}）`);
    }
    return { text: content, metadata };
}

async function dmxChatCompletion(prompt: string, apiKey: string, model: string, timeoutMs: number, maxOutputTokens: number, imageUrls: string[] = [], singleAttempt = false): Promise<ProviderTextResult> {
  try {
    const preferResponses = isResponsesPreferredModel(model);
    const transports: Array<'chat/completions' | 'responses'> = preferResponses
      ? ['responses', 'chat/completions']
      : ['chat/completions'];
    const failures: string[] = [];

    for (const endpoint of transports) {
      try {
        const body = endpoint === 'responses'
          ? {
              model,
              input: responsesInput(prompt, imageUrls),
              stream: false,
              max_output_tokens: maxOutputTokens,
              reasoning: { effort: 'low' },
            }
          : {
              model,
              stream: false,
              ...(preferResponses
                ? { max_completion_tokens: maxOutputTokens, reasoning_effort: 'low' }
                : { max_tokens: maxOutputTokens }),
              messages: [{ role: 'user', content: chatInputContent(prompt, imageUrls) }],
            };
        return await requestDmxText(endpoint, body, apiKey, timeoutMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${endpoint}: ${message}`);
        if (singleAttempt || isProviderContentRejection(error)) throw error;
        // A timeout means the model did not finish this payload in time. Sending
        // the same oversized request through the alternate OpenAI transport only
        // doubles the wait; transport fallback remains useful for shape/endpoint
        // incompatibilities and explicit upstream errors.
        if (/timeout|timed out|ECONNABORTED/i.test(message)) break;
      }
    }
    throw new Error(failures.join('；'));
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error('[story-llm] DMXAPI failed:', normalized.message);
    throw normalized;
  }
}

interface ChatOptions { apiKey?: string; dmxApiKey?: string; provider?: ScriptProvider; model?: string; maxOutputTokens?: number; timeoutMs?: number; imageUrls?: string[]; singleAttempt?: boolean }

export async function chatOnce(prompt: string, opts: ChatOptions): Promise<string> {
  return (await chatOnceResult(prompt, opts)).text;
}

export async function chatOnceResult(
  prompt: string,
  opts: ChatOptions,
): Promise<ProviderTextResult> {
  const { apiKey = '', dmxApiKey = '', provider = 'auto', model = 'gpt-4o', maxOutputTokens = 24_000 } = opts;
  if (provider === 'dmx' && !dmxApiKey) throw new Error('剧本 API 选择了 DMX，但尚未配置 DMXAPI Key');
  if (provider === 'apimart' && !apiKey) throw new Error('剧本 API 选择了 APIMart，但尚未配置 APIMart API Key');

  const order = scriptProviderOrder(provider, Boolean(dmxApiKey), Boolean(apiKey));
  if (!order.length) throw new Error('没有可用的剧本 API Key');

  const isLocalCompanion = process.env.AID_LOCAL_COMPANION === '1';
  // Hosted functions have a hard 60-second ceiling. The Companion can allow
  // long-form planning requests to finish without a gateway replacing JSON.
  const providerTimeout = opts.timeoutMs ?? (isLocalCompanion ? 240_000 : order.length > 1 ? 24_000 : 50_000);
  const errors: string[] = [];

  for (const candidate of order) {
    try {
      if (candidate === 'dmx') return await dmxChatCompletion(prompt, dmxApiKey, model, providerTimeout, maxOutputTokens, opts.imageUrls, opts.singleAttempt);
      return await chatCompletionResult(prompt, apiKey, model, providerTimeout, maxOutputTokens, opts.imageUrls, opts.singleAttempt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const label = candidate === 'dmx' ? 'DMXAPI' : 'APIMart';
      console.error(`[story-llm] ${label} failed:`, message);
      errors.push(`${label}：${message}`);
      if (opts.singleAttempt || isProviderContentRejection(error)) throw error;
    }
  }

  throw new Error(errors.join('；') || '剧本 API 请求失败');
}
