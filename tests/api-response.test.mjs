import assert from 'node:assert/strict';
import test from 'node:test';

import { readApiJson } from '../lib/apiResponse.ts';

test('reads the final JSON data event from a keep-alive screenplay stream', async () => {
  const response = new Response(': connected\n\n: keep-alive\n\ndata: {"storyPlan":{"title":"Film"}}\n\n', {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
  const data = await readApiJson(response, '剧本规划失败');
  assert.equal(data.storyPlan.title, 'Film');
});

test('surfaces a streamed screenplay task failure with its original context', async () => {
  const response = new Response('data: {"error":"DMXAPI timeout"}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
  await assert.rejects(() => readApiJson(response, '剧本规划失败'), /剧本规划失败：DMXAPI timeout/);
});
