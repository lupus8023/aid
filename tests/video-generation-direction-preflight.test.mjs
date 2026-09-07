import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../app/api/generate-video/route.ts';
import { videoDirectionSourceKey } from '../lib/videoDirection.ts';

test('video submission refuses absent or stale directing before any paid provider call', async () => {
  const original = {
    id: 'shot1', characters: ['裴慎之'], objects: ['白玉杯'], durationHint: 7,
    action: '裴慎之把白玉杯放在桌上。', imageUrl: 'https://example.com/cup.jpg',
    videoDirection: { action: '裴慎之放下白玉杯。', camera: '固定中景看向桌面。', detail: '', ending: '白玉杯留在桌边。' },
  };
  original.videoDirectionSource = videoDirectionSourceKey(original);
  for (const storyboard of [
    { ...original, videoDirection: undefined },
    { ...original, durationHint: 4 },
  ]) {
    const response = await POST(new Request('http://localhost/api/generate-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboard, videoProvider: 'comfyui' }),
    }));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, 'VIDEO_DIRECTION_STALE');
    assert.match(body.error, /尚未提交视频生成/);
  }
});
