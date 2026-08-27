import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchStoryApi } from '../lib/comfyuiClient.ts';

test('does not silently send a long screenplay to the hosted function when Companion is unreachable', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    throw new Error('local network access denied');
  };
  try {
    const response = await fetchStoryApi('/api/generate-story-plan', { method: 'POST' }, {
      useLocalCompanion: true,
      localCompanionUrl: 'http://127.0.0.1:3018',
    });
    const data = await response.json();
    assert.equal(response.status, 503);
    assert.match(data.error, /本地 Companion/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:3018/')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses the Companion screenplay route after a successful status probe', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).endsWith('/api/companion/status')) {
      return Response.json({ ok: true, version: '0.1.89' });
    }
    return new Response('data: {"storyPlan":{"title":"Film"}}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  try {
    const response = await fetchStoryApi('/api/generate-story-plan', { method: 'POST' }, {
      useLocalCompanion: true,
      localCompanionUrl: 'http://127.0.0.1:3018',
    });
    assert.match(await response.text(), /"Film"/);
    assert.deepEqual(calls, [
      'http://127.0.0.1:3018/api/companion/status',
      'http://127.0.0.1:3018/api/generate-story-plan',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an older Companion before sending the screenplay request', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return Response.json({ ok: true, version: '0.1.88' });
  };
  try {
    const response = await fetchStoryApi('/api/generate-story-plan', { method: 'POST' }, {
      useLocalCompanion: true,
      localCompanionUrl: 'http://127.0.0.1:3018',
    });
    const data = await response.json();
    assert.equal(response.status, 426);
    assert.match(data.error, /v0\.1\.89/);
    assert.deepEqual(calls, ['http://127.0.0.1:3018/api/companion/status']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
