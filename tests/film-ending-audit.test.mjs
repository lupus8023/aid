import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFilmEnding, filmEndingDisposition, prepareFilmEndingRepair } from '../lib/filmEndingAudit.ts';
import { filmEndingDuration } from '../lib/filmEnding.ts';
import { videoSegmentGenerationSignature } from '../lib/videoSegments.ts';

test('actual ending speech is rejected; silence never excuses missing dialogue or unknown ASR', () => {
  const transcript = { text: 'Absolutely not.', segments: [{ start: 5.5, end: 6.3, text: 'Absolutely not.' }] };
  assert.equal(evaluateFilmEnding(6.58, 'Absolutely not.', transcript).passed, false);
  assert.equal(evaluateFilmEnding(8.58, 'Absolutely not.', transcript).passed, true);
  assert.equal(evaluateFilmEnding(8.58, 'Absolutely not.', { text: '', segments: [] }).passed, false);
  assert.throws(() => evaluateFilmEnding(8, 'Absolutely not.', { error: 'timeout' }), /有效/);
  assert.throws(() => evaluateFilmEnding(8, 'Absolutely not.', { text: 'Absolutely not.' }), /时间戳/);
  assert.equal(evaluateFilmEnding(8, '', { text: '', segments: [] }).passed, true);
});

test('repair changes only final segment, preserves dialogue and prior tasks, and cannot reset its budget', () => {
  const earlier = { id: 'first', sceneNumber: 1, imageUrl: 'first.png', videoTaskId: 'paid-first', videoStatus: 'completed' };
  const ending = { id: 'last', sceneNumber: 18, imageUrl: 'last.png', videoTaskId: 'paid-last', videoStatus: 'completed',
    videoDuration: 6, videoCacheKey: 'old-cache', speech: [{ character: 'Luna', exactLine: 'Absolutely not.' }] };
  const audit = { version: 1, taskId: 'paid-last', duration: 6.58, passed: false, dialogueMatch: 0.3, reason: '末镜转写与完整台词不匹配' };
  const all = [earlier, ending], repaired = prepareFilmEndingRepair(all, [ending], audit);
  assert.equal(repaired[0], earlier);
  assert.equal(repaired[1].imageUrl, ending.imageUrl);
  assert.deepEqual(repaired[1].speech, ending.speech);
  assert.equal(repaired[1].videoTaskId, undefined);
  assert.equal(repaired[1].videoEndingMinimumDuration, 9);
  assert.equal(repaired[1].videoEndingHistory[0].taskId, ending.videoTaskId);
  assert.equal(repaired[1].videoEndingHistory[0].videoCacheKey, ending.videoCacheKey);
  assert.equal(repaired[1].videoEndingRepairAttempts, 1);
  assert.notEqual(videoSegmentGenerationSignature([repaired[1]]), videoSegmentGenerationSignature([ending]));
  assert.throws(() => prepareFilmEndingRepair(all, [earlier], { ...audit, taskId: 'paid-first' }), /整片末镜/);
  assert.throws(() => prepareFilmEndingRepair(all, [ending], { ...audit, taskId: 'stale' }), /任务已改变/);
  const exhausted = { ...ending, videoEndingRepairAttempts: 2 };
  assert.throws(() => prepareFilmEndingRepair([earlier, exhausted], [exhausted], audit), /上限/);
  assert.equal(ending.videoTaskId, 'paid-last', 'input receipt is immutable');
});

test('a short quiet tail stays a visible warning and never spends a paid repair', () => {
  const ending = { id: 'last', sceneNumber: 18, videoTaskId: 'paid-last', videoStatus: 'completed' };
  const audit = { version: 1, taskId: 'paid-last', duration: 9.417, passed: false, dialogueMatch: 0.875, lastSpeechEnd: 8.88 };
  assert.equal(filmEndingDisposition(audit), 'warning');
  assert.equal(audit.passed, false, 'warning must not be relabeled a passed quiet-tail audit');
  assert.throws(() => prepareFilmEndingRepair([ending], [ending], audit), /记录提示而不重生成/);
  assert.equal(filmEndingDisposition({ ...audit, dialogueMatch: 0.125 }), 'repair-dialogue');
  assert.equal(filmEndingDisposition({ ...audit, passed: true }), 'passed');
});

test('only film ending receives extra headroom, and preview/request durations are idempotent', () => {
  assert.equal(filmEndingDuration(6, false), 6);
  assert.equal(filmEndingDuration(6, true), 8);
  assert.equal(filmEndingDuration(6, true, 8), 8);
  assert.equal(filmEndingDuration(6, true, 8, 11), 11);
  assert.equal(filmEndingDuration(6, false, 6, 11), 6);
  assert.equal(filmEndingDuration(14, true), 15);
});
