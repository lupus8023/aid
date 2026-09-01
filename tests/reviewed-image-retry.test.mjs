import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReviewedImageRetry } from '../lib/reviewedImageRetry.ts';

test('a reviewed benign age ambiguity preserves the refused receipt and clears only the shot lock', () => {
  const original = { id: 's7', sceneNumber: 7, description: 'Political broadcast.', prompt: 'Oscar faces a live camera.', characters: ['Oscar'], status: 'failed', taskId: 'paid-refused', imageTaskMode: 'single', imageFailureReason: 'The generated content was filtered by the safety system.' };
  const retried = prepareReviewedImageRetry(original, 'Reviewed: all cast are adults and the political scene is non-violent.');
  assert.equal(retried.status, 'pending');
  assert.equal(retried.taskId, undefined);
  assert.equal(retried.imageTaskMode, undefined);
  assert.match(retried.imagePromptOverride, /adult over 21/);
  assert.equal(retried.imageFailureHistory[0].taskId, 'paid-refused');
  assert.equal(original.taskId, 'paid-refused');
});

test('reviewed retry cannot clear a timeout, an unreceipted failure, or a refusal without review', () => {
  const base = { id: 's7', sceneNumber: 7, description: '', prompt: '', characters: [], status: 'failed', taskId: 'paid', imageFailureReason: 'timeout' };
  assert.throws(() => prepareReviewedImageRetry(base, 'reviewed'), /已审核重试/);
  assert.throws(() => prepareReviewedImageRetry({ ...base, taskId: undefined, imageFailureReason: 'safety system' }, 'reviewed'), /已审核重试/);
  assert.throws(() => prepareReviewedImageRetry({ ...base, imageFailureReason: 'safety system' }, ''), /已审核重试/);
});
