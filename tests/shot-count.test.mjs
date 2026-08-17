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

test('shot count options are multiples of nine capped at 81', () => {
  assert.deepEqual([...SHOT_COUNT_OPTIONS], [9, 18, 27, 36, 45, 54, 63, 72, 81]);
  assert.equal(DEFAULT_TARGET_SHOT_COUNT, 18);
  assert.equal(MAX_TARGET_SHOT_COUNT, 81);
});

test('shot count input is normalized to a supported option', () => {
  assert.equal(normalizeTargetShotCount(undefined), 18);
  assert.equal(normalizeTargetShotCount(26), 27);
  assert.equal(normalizeTargetShotCount(999), 81);
  assert.equal(normalizeTargetShotCount(-1), 9);
});

test('runtime estimate uses five seconds per shot', () => {
  assert.equal(targetDurationSeconds(9), 45);
  assert.equal(targetDurationSeconds(81), 405);
});

test('production contract and beat counter preserve the exact quota', () => {
  assert.match(buildShotCountContract(27, 'zh'), /严格生成 27 个镜头/);
  assert.match(buildShotCountContract(27, 'en'), /exactly 27 shots/);
  assert.equal(storyPlanBeatCount({ sequences: [{ beats: [{}, {}] }, { beats: [{}] }] }), 3);
});
