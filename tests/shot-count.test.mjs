import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TARGET_SHOT_COUNT,
  MAX_TARGET_SHOT_COUNT,
  SHOT_COUNT_OPTIONS,
  buildShotCountContract,
  normalizeTargetShotCount,
  storyPlanBeatCount,
  targetDurationSeconds,
} from '../lib/pipeline/shotCount.ts';

test('shot count options are multiples of four capped at 80', () => {
  assert.deepEqual([...SHOT_COUNT_OPTIONS], [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80]);
  assert.equal(DEFAULT_TARGET_SHOT_COUNT, 16);
  assert.equal(MAX_TARGET_SHOT_COUNT, 80);
});

test('shot count input is normalized to a supported option', () => {
  assert.equal(normalizeTargetShotCount(undefined), 16);
  assert.equal(normalizeTargetShotCount(26), 24);
  assert.equal(normalizeTargetShotCount(999), 80);
  assert.equal(normalizeTargetShotCount(-1), 4);
});

test('runtime estimate uses five seconds per shot', () => {
  assert.equal(targetDurationSeconds(4), 20);
  assert.equal(targetDurationSeconds(80), 400);
});

test('production contract and beat counter preserve the exact quota', () => {
  assert.match(buildShotCountContract(28, 'zh'), /严格生成 28 个镜头/);
  assert.match(buildShotCountContract(28, 'en'), /exactly 28 shots/);
  assert.equal(storyPlanBeatCount({ sequences: [{ beats: [{}, {}] }, { beats: [{}] }] }), 3);
});
