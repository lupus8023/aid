export class ApiResponseError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) { super(message); this.code = code; this.status = status; }
}

export function isRequestTooLargeError(error: unknown): boolean {
  if (error instanceof ApiResponseError && (error.status === 413 || error.code === 'REQUEST_TOO_LARGE')) return true;
  // Grid failures can be aggregated into a plain Error; keep this detectable
  // after that boundary and when restoring older saved error messages.
  const message = error instanceof Error ? error.message : String(error || '');
  return /HTTP\s*413\b|请求数据过大|payload too large|request entity too large|request body too large/i.test(message);
}

function looksLikeHtml(body: string, contentType: string): boolean {
  return contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body);
}

function statusHint(status: number): string {
  if (status === 413) return '请求数据过大，服务器拒绝接收';
  if ([502, 503, 504].includes(status)) return '上游服务暂时不可用或请求超时';
  if (status === 429) return '请求过于频繁，请稍后重试';
  return `请求失败（HTTP ${status}）`;
}

/**
 * Read an API response exactly once and keep HTML gateway/error pages away from
 * JSON.parse. This is shared by Story's browser-side generation requests.
 */
export async function readApiJson<T>(response: Response, context: string, options: { taskStatus?: boolean } = {}): Promise<T> {
  const body = await response.text();
  // Gateways may return HTML, plain text, JSON or an empty body for 413.
  // Classify it before parsing; retrying unchanged bytes cannot repair it.
  if (response.status === 413) {
    throw new ApiResponseError(`${context}：请求数据过大，服务器拒绝接收；请先将参考图单独上传后再提交，不会自动重试此请求`, 'REQUEST_TOO_LARGE', 413);
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  let data: any;

  if (body.trim()) {
    try {
      if (contentType.includes('text/event-stream')) {
        const events = body
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .filter(Boolean);
        if (!events.length) throw new Error('missing SSE data event');
        data = JSON.parse(events[events.length - 1]);
      } else {
        data = JSON.parse(body);
      }
    } catch {
      if (looksLikeHtml(body, contentType)) {
        throw new Error(`${context}：${statusHint(response.status)}，服务器返回了错误网页而不是数据。请重试；若持续发生，请检查本地 Companion 或切换剧本 API。`);
      }
      throw new Error(`${context}：服务器返回了无法识别的数据（HTTP ${response.status}）`);
    }
  }

  if (!response.ok) {
    const message = typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string'
        ? data.message
        : statusHint(response.status);
    throw new ApiResponseError(`${context}：${message}`, data?.code, response.status);
  }

  // Streaming responses have already committed HTTP 200 before the long task
  // finishes, so task failures arrive as a structured final event.
  if (typeof data?.error === 'string' && data.error.trim() &&
      !(options.taskStatus && !contentType.includes('text/event-stream') && data.status === 'failed')) {
    throw new ApiResponseError(`${context}：${data.error}`, data?.code);
  }

  if (data === undefined) throw new Error(`${context}：服务器返回了空响应`);
  return data as T;
}
