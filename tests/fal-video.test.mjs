import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFalH3MaxVideoTask,
  falRequestId,
  getFalH3MaxVideoStatus,
  isFalVideoTask,
} from '../lib/falVideo.ts';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('submits the official H3 Max queue payload with a reproducible seed', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ request_id: 'request-123', status: 'IN_QUEUE' });
  });

  const result = await createFalH3MaxVideoTask({
    prompt: 'A woman looks toward camera. <d>[English] Hello.</d>',
    imageUrl: 'https://example.com/start.jpg',
    endImageUrl: 'https://example.com/end.jpg',
    duration: 20,
    resolution: '768P',
    promptExpansionMode: 'disabled',
    seed: 424242,
    apiKey: 'fal-test-key',
  });

  assert.deepEqual(result, { taskId: 'fal:request-123', requestId: 'request-123' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://queue.fal.run/minimax/h3-max/image-to-video');
  assert.equal(calls[0].init.headers.Authorization, 'Key fal-test-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: 'A woman looks toward camera. <d>[English] Hello.</d>',
    duration: 15,
    resolution: '768P',
    prompt_expansion_mode: 'disabled',
    enable_safety_checker: true,
    sync_mode: false,
    seed: 424242,
    image_url: 'https://example.com/start.jpg',
    end_image_url: 'https://example.com/end.jpg',
  });
});

test('uses safe API defaults and enforces the five-second minimum', async (t) => {
  let payload;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    payload = JSON.parse(init.body);
    return jsonResponse({ request_id: 'request-defaults' });
  });

  await createFalH3MaxVideoTask({
    prompt: 'Street scene.',
    duration: 2,
    apiKey: 'fal-test-key',
  });

  assert.equal(payload.duration, 5);
  assert.equal(payload.resolution, '768P');
  assert.equal(payload.prompt_expansion_mode, 'disabled');
  assert.equal('seed' in payload, false);
});

test('polls status and returns the completed fal video', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    if (String(url).endsWith('/status?logs=0')) return jsonResponse({ status: 'COMPLETED' });
    return jsonResponse({
      video: { url: 'https://fal.media/output.mp4' },
      expanded_prompt: 'Expanded prompt',
      timings: { inference: 12.5 },
    });
  });

  assert.equal(isFalVideoTask('fal:request-456'), true);
  assert.equal(falRequestId('fal:request-456'), 'request-456');
  const status = await getFalH3MaxVideoStatus('fal:request-456', 'fal-test-key');
  assert.deepEqual(status, {
    status: 'completed',
    videoUrl: 'https://fal.media/output.mp4',
    expandedPrompt: 'Expanded prompt',
    timings: { inference: 12.5 },
  });
  assert.equal(urls.length, 2);
  assert.equal(
    urls[0],
    'https://queue.fal.run/minimax/h3-max/requests/request-456/status?logs=0',
  );
  assert.equal(
    urls[1],
    'https://queue.fal.run/minimax/h3-max/requests/request-456',
  );
  assert.ok(urls.every(url => !url.includes('/image-to-video/requests/')));
});
