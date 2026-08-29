import test from 'node:test';
import assert from 'node:assert/strict';

import {
  completeProductionTiming,
  formatProductionElapsed,
  normalizeProductionTiming,
  pauseProductionTiming,
  productionElapsedMs,
  startProductionTiming,
} from '../lib/productionTiming.ts';

test('tracks active project production time across pause and resume', () => {
  const started = startProductionTiming(undefined, 1_000);
  assert.equal(productionElapsedMs(started, 11_000), 10_000);

  const paused = pauseProductionTiming(started, 11_000);
  assert.equal(paused?.status, 'paused');
  assert.equal(productionElapsedMs(paused, 31_000), 10_000);

  const resumed = startProductionTiming(paused, 31_000);
  assert.equal(resumed.pausedDurationMs, 20_000);
  assert.equal(productionElapsedMs(resumed, 36_000), 15_000);

  const completed = completeProductionTiming(resumed, 41_000);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.elapsedMs, 20_000);
  assert.equal(productionElapsedMs(completed, 99_000), 20_000);
});

test('survives project JSON normalization and formats long runs', () => {
  const normalized = normalizeProductionTiming(JSON.parse(JSON.stringify({
    startedAt: new Date(1_000).toISOString(),
    status: 'completed',
    pausedDurationMs: 2_000,
    completedAt: new Date(3_662_000).toISOString(),
    elapsedMs: 3_660_000,
  })));
  assert.equal(normalized?.elapsedMs, 3_660_000);
  assert.equal(formatProductionElapsed(normalized?.elapsedMs), '1h01m00s');
  assert.equal(formatProductionElapsed(undefined), '尚未开始');
});
