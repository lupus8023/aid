import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  applyStoryAspectRatio,
  hasStoryMedia,
  projectStoryAspectRatio,
  storyAspectRatioFromDimensions,
} from '../lib/storyAspectRatio.ts';

const storyboard = (extra = {}) => ({
  id: 'scene-1', sceneNumber: 1, description: '', prompt: '', characters: [],
  status: 'completed', aspectRatio: '16:9', imageUrl: 'https://example.com/landscape.jpg',
  videoUrl: 'blob:old-video', videoSourceUrl: 'https://example.com/landscape.mp4',
  videoTaskId: 'task-old', videoStatus: 'completed', videoCacheKey: 'old-cache',
  ...extra,
});

test('project aspect ratio overrides stale storyboard and global settings values', () => {
  assert.equal(projectStoryAspectRatio('9:16', [storyboard()], '16:9'), '9:16');
  assert.equal(projectStoryAspectRatio(undefined, [storyboard({ aspectRatio: '9:16' })], '16:9'), '9:16');
  assert.equal(projectStoryAspectRatio(undefined, [], '1:1'), '1:1');
});

test('switching to portrait invalidates landscape image and video artifacts', () => {
  const source = [storyboard()];
  assert.equal(hasStoryMedia(source), true);
  const [portrait] = applyStoryAspectRatio(source, '9:16');
  assert.equal(portrait.aspectRatio, '9:16');
  assert.equal(portrait.status, 'pending');
  assert.equal(portrait.videoStatus, 'pending');
  assert.equal(portrait.imageUrl, undefined);
  assert.equal(portrait.videoUrl, undefined);
  assert.equal(portrait.videoSourceUrl, undefined);
  assert.equal(portrait.videoTaskId, undefined);
  assert.equal(portrait.videoCacheKey, undefined);
});

test('video metadata automatically selects portrait, landscape or square preview', () => {
  assert.equal(storyAspectRatioFromDimensions(736, 1280), '9:16');
  assert.equal(storyAspectRatioFromDimensions(1280, 736), '16:9');
  assert.equal(storyAspectRatioFromDimensions(1024, 1024), '1:1');
  assert.equal(storyAspectRatioFromDimensions(0, 0, '9:16'), '9:16');
});

test('Story UI locks the selected project ratio into image and video requests', async () => {
  const stepSource = await readFile(new URL('../components/Step1.tsx', import.meta.url), 'utf8');
  const pageSource = await readFile(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  assert.match(stepSource, /\['16:9', '9:16', '1:1'\]/);
  assert.match(stepSource, /画幅会在剧本阶段锁定/);
  assert.match(pageSource, /aspectRatio: projectAspectRatioRef\.current/);
  assert.doesNotMatch(pageSource, /aspectRatio: leader\.aspectRatio \|\| settings\.aspectRatio/);
});
