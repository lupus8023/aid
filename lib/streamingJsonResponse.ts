type JsonTask = () => Promise<Record<string, unknown>>;

/**
 * Keep long screenplay requests alive through hosting proxies that otherwise
 * replace a valid JSON response with an HTML 502/504 page while the model is
 * still writing. The browser-side response reader understands the final SSE
 * data event exactly like a normal JSON response.
 */
export function streamingJsonResponse(task: JsonTask): Response {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  let closed = false;

  const write = async (value: string) => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(value));
    } catch {
      closed = true;
    }
  };

  const pingInterval = setInterval(() => {
    void write(`: keep-alive ${Date.now()}\n\n`);
  }, 5_000);

  void (async () => {
    try {
      await write(': connected\n\n');
      const data = await task();
      await write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown error');
      await write(`data: ${JSON.stringify({ error: message })}\n\n`);
    } finally {
      clearInterval(pingInterval);
      if (!closed) {
        closed = true;
        try { await writer.close(); } catch {}
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
