import test from 'node:test';
import assert from 'node:assert/strict';

import {
  autoRetryDelayMs,
  normalizeStoryboardImageArtifact,
  planAutoImageBatch,
} from '../lib/autoProduction.ts';

const shot = (sceneNumber, extra = {}) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  description: `shot ${sceneNumber}`,
  prompt: '',
  characters: [],
  status: 'pending',
  ...extra,
});

test('treats an existing image as completed even when its stale UI status disagrees', () => {
  const normalized = normalizeStoryboardImageArtifact(shot(1, {
    imageUrl: 'https://example.com/scene-1.webp',
    status: 'generating',
    imageFailureReason: 'old timeout',
  }));
  assert.equal(normalized.status, 'completed');
  assert.equal(normalized.imageFailureReason, undefined);
  assert.deepEqual(planAutoImageBatch([normalized]), { kind: 'skip' });
});

test('reattaches a partially delivered grid to its paid task before regenerating', () => {
  const group = [
    shot(1, { imageUrl: 'https://example.com/1.webp', status: 'completed', taskId: 'grid-1' }),
    shot(2, { status: 'generating', taskId: 'grid-1' }),
    shot(3, { status: 'failed', taskId: 'grid-1' }),
  ];
  assert.deepEqual(planAutoImageBatch(group), { kind: 'resume-grid', taskId: 'grid-1' });
});

test('does not mistake an interrupted single-image repair for a grid task', () => {
  const group = [
    shot(1, { imageUrl: 'https://example.com/1.webp', status: 'completed' }),
    shot(2, { status: 'generating', taskId: 'single-2', imageTaskMode: 'single' }),
  ];
  assert.deepEqual(planAutoImageBatch(group), { kind: 'generate-missing', storyboardIds: ['scene-2'] });
});

test('repairs only missing cards when no grid task can be recovered', () => {
  const group = [
    shot(1, { imageUrl: 'https://example.com/1.webp', status: 'completed' }),
    shot(2),
    shot(3, { imageUrl: 'https://example.com/3.webp', status: 'completed' }),
  ];
  assert.deepEqual(planAutoImageBatch(group), { kind: 'generate-missing', storyboardIds: ['scene-2'] });
  assert.deepEqual(planAutoImageBatch([shot(1), shot(2)]), { kind: 'generate-grid' });
});

test('uses bounded exponential-style retry delays', () => {
  assert.equal(autoRetryDelayMs(1), 3_000);
  assert.equal(autoRetryDelayMs(2), 8_000);
  assert.equal(autoRetryDelayMs(5), 60_000);
  assert.equal(autoRetryDelayMs(99), 60_000);
});
