export function chatInputContent(prompt: string, imageUrls: string[] = []) {
  return imageUrls.length ? [{ type: 'text', text: prompt }, ...imageUrls.map(url => ({ type: 'image_url', image_url: { url, detail: 'auto' } }))] : prompt;
}

export function isProviderContentRejection(error: unknown): boolean {
  return /content policy violation|content safety system|image processing blocked|content_filter|content moderation|safety policy|未通过(?:内容)?审核|审核不通过|审核拒绝|内容违规/i.test(error instanceof Error ? error.message : String(error));
}

export function responsesInput(prompt: string, imageUrls: string[] = []) {
  return imageUrls.length ? [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...imageUrls.map(image_url => ({ type: 'input_image', image_url, detail: 'auto' }))] }] : prompt;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const value = item as Record<string, unknown>;
    return typeof value.text === 'string'
      ? value.text
      : typeof value.content === 'string'
        ? value.content
        : '';
  }).filter(Boolean).join('\n').trim();
}

/** Extracts final answer text from Chat Completions, Responses API and common gateway wrappers. */
export function extractProviderText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload as Record<string, any>;
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const chatContent = textFromContent(choice?.message?.content);
  if (chatContent) return chatContent;

  if (choice?.message?.parsed && typeof choice.message.parsed === 'object') {
    return JSON.stringify(choice.message.parsed);
  }
  if (typeof choice?.text === 'string' && choice.text.trim()) return choice.text.trim();
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();

  if (Array.isArray(data.output)) {
    const responseText = data.output
      .filter((item: any) => item?.type === 'message' || item?.role === 'assistant')
      .map((item: any) => textFromContent(item?.content))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (responseText) return responseText;
  }

  const topLevelContent = textFromContent(data.content);
  if (topLevelContent) return topLevelContent;

  // Some gateways wrap the provider response in data/result/response.
  for (const key of ['data', 'result', 'response']) {
    if (data[key] && data[key] !== payload) {
      const nested = extractProviderText(data[key]);
      if (nested) return nested;
    }
  }
  return '';
}

/** Safe structural diagnostics: never includes generated text, prompts, or credentials. */
export function providerPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return `type=${typeof payload}`;
  const data = payload as Record<string, any>;
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const message = choice?.message;
  const outputTypes = Array.isArray(data.output)
    ? data.output.map((item: any) => String(item?.type || item?.role || 'unknown')).slice(0, 8)
    : [];
  return JSON.stringify({
    keys: Object.keys(data).slice(0, 20),
    object: data.object,
    model: data.model,
    status: data.status,
    errorType: data.error?.type,
    errorCode: data.error?.code,
    choiceCount: Array.isArray(data.choices) ? data.choices.length : 0,
    finishReason: choice?.finish_reason,
    messageKeys: message && typeof message === 'object' ? Object.keys(message).slice(0, 20) : [],
    hasRefusal: Boolean(message?.refusal),
    toolCallCount: Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0,
    outputTypes,
  });
}

export function isResponsesPreferredModel(model: string): boolean {
  return /^gpt-5(?:[.\-]|$)/i.test(model.trim());
}
