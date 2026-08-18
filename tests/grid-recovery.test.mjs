import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSavedImageFailureReason,
  planInterruptedGridRecovery,
} from '../lib/gridRecovery.ts';

test('resumes a refreshed grid batch when one durable task id is available', () => {
  assert.deepEqual(planInterruptedGridRecovery([
    { status: 'generating', taskId: 'task-1' },
    { status: 'generating', taskId: 'task-1' },
  ]), { kind: 'resume', taskId: 'task-1' });
});

test('releases a stale generating lock when no task can be resumed', () => {
  const plan = planInterruptedGridRecovery([{ status: 'generating' }, { status: 'generating' }]);
  assert.equal(plan.kind, 'release');
  assert.match(plan.reason, /解除锁定/);
});

test('normalizes legacy object-string errors into an actionable diagnosis', () => {
  assert.match(normalizeSavedImageFailureReason('[object Object]'), /结构化错误/);
});
