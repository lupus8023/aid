/** Only connection failures that prove the HTTP request did not reach a server
 * are safe to replay. A reset, timeout or missing response alone is ambiguous. */
export function isRequestDefinitelyNotSent(error: unknown): boolean {
  if (error instanceof ProviderRequestNotSentError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { response?: unknown; code?: string; message?: string; syscall?: string; request?: { _redirectCount?: number } };
  if (e.response || (e.request?._redirectCount || 0) > 0) return false;
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return true;
  if (e.code === 'ECONNREFUSED' && e.syscall === 'connect') return true;
  return e.code === 'ECONNRESET' && /disconnected before secure TLS connection was established/i.test(e.message || '');
}

export class ProviderRequestNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRequestNotSentError';
  }
}
