import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('allows every browser-to-Companion Story media route through CORS', async () => {
  const source = await readFile(new URL('../middleware.ts', import.meta.url), 'utf8');
  for (const route of [
    '/api/companion/status',
    '/api/generate-audio',
    '/api/generate-video',
    '/api/check-video-status',
    '/api/comfyui/download',
  ]) {
    assert.match(source, new RegExp(`['\"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`));
  }
  assert.match(source, /Access-Control-Allow-Private-Network/);
});
