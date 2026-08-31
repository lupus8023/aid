import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSavedImageFailureReason,
  planInterruptedGridRecovery,
  preserveCompletedGridArtifacts,
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

test('resume keeps single-image repairs and paid videos while filling only missing cells', () => {
  const current = [
    {id:'1', imageUrl:'durable-crop', videoTaskId:'paid-video'},
    {id:'2', imageUrl:'repaired-single', imageTaskMode:'single', videoTaskId:'paid-repair-video'},
    {id:'3', taskId:'paid-grid'},
  ];
  const proposed = current.map(c => ({id:c.id, imageUrl:'new-grid-'+c.id}));
  const next = preserveCompletedGridArtifacts(current, proposed);
  assert.strictEqual(next[0], current[0]); assert.strictEqual(next[1], current[1]);
  assert.equal(next[2].imageUrl, 'new-grid-3');
  assert.deepEqual(planInterruptedGridRecovery([{status:'generating',imageUrl:'saved',taskId:'old-grid'}]), {kind:'none'});
});
