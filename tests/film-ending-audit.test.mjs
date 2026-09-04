import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FILM_ENDING_ASR_SKIPPED_WARNING, evaluateFilmEnding, retainFilmEndingForDelivery } from '../lib/filmEndingAudit.ts';
import { filmEndingDuration } from '../lib/filmEnding.ts';
import { isCompletedPlannedVideoSegment, videoSegmentGenerationSignature } from '../lib/videoSegments.ts';

test('explicit diagnostics remain honest about missing dialogue and unavailable ASR', () => {
  const transcript = { text: 'Absolutely not.', segments: [{ start: 5.5, end: 6.3, text: 'Absolutely not.' }] };
  assert.equal(evaluateFilmEnding(6.58, 'Absolutely not.', transcript).passed, false);
  assert.equal(evaluateFilmEnding(8.58, 'Absolutely not.', transcript).passed, true);
  assert.equal(evaluateFilmEnding(8.58, 'Absolutely not.', { text: '', segments: [] }).passed, false);
  assert.throws(() => evaluateFilmEnding(8, 'Absolutely not.', { error: 'timeout' }), /有效/);
  assert.throws(() => evaluateFilmEnding(8, 'Absolutely not.', { text: 'Absolutely not.' }), /时间戳/);
  assert.equal(evaluateFilmEnding(8, '', { text: '', segments: [] }).passed, true);
});

test('resuming an ASR-failed checkpoint keeps every paid clip, signature, dialogue and history', () => {
  const earlier = { id: 'first', sceneNumber: 1, imageUrl: 'first.png', videoTaskId: 'paid-first', videoStatus: 'completed' };
  for (const audit of [undefined,
    { taskId: 'paid-last', passed: false, dialogueMatch: 0.125 },
    { taskId: 'paid-last', passed: false, dialogueMatch: 0.875, lastSpeechEnd: 8.88 },
    { taskId: 'stale-task', passed: false, dialogueMatch: 0 },
    { taskId: 'paid-last', passed: true, dialogueMatch: 1 },
  ]) {
    const ending = { id: 'last', sceneNumber: 16, imageUrl: 'last.png', videoTaskId: 'paid-last', videoStatus: 'completed',
      videoUrl: 'blob:paid-last', videoSourceUrl: 'https://assets.test/last.mp4', videoDuration: 9,
      videoSegmentId: 'segment-last', videoSegmentStoryboardIds: ['last'],
      videoCacheKey: 'old-cache', videoCacheStatus: 'cached', videoEndingAudit: audit,
      videoEndingRepairAttempts: 2, videoEndingMinimumDuration: 9,
      videoEndingHistory: [{ taskId: 'previous-paid-last', duration: 7, reason: 'old audit' }],
      speech: [{ character: 'Luna', exactLine: 'Absolutely not.' }] };
    ending.videoGenerationSignature = videoSegmentGenerationSignature([ending]);
    const all = [earlier, ending], retained = retainFilmEndingForDelivery(all, [ending]);
    assert.equal(retained[0], earlier);
    assert.deepEqual(retained[1], { ...ending, videoEndingWarning: FILM_ENDING_ASR_SKIPPED_WARNING });
    assert.equal(retained[1].videoEndingAudit, audit, 'never fabricate an ASR pass or discard diagnostics');
    assert.equal(videoSegmentGenerationSignature([retained[1]]), ending.videoGenerationSignature);
    assert.ok(isCompletedPlannedVideoSegment(retained, [ending]), 'resume must skip paid generation');
    assert.equal(retainFilmEndingForDelivery(retained, [ending]), retained, 'checkpoint restart is idempotent');
    assert.equal(ending.videoEndingWarning, undefined, 'input receipt is immutable');
  }
});

test('skipping ASR only annotates the completed final segment leader, not missing media', () => {
  const first = { id: 'first', sceneNumber: 1, videoStatus: 'completed' };
  const leader = { id: 'leader', sceneNumber: 3, videoStatus: 'completed', videoTaskId: 'paid-group' };
  const follower = { id: 'last', sceneNumber: 4, videoStatus: 'completed', videoTaskId: 'paid-group' };
  const all = [first, leader, follower];
  assert.equal(retainFilmEndingForDelivery(all, [first]), all);
  assert.equal(retainFilmEndingForDelivery(all, []), all);
  const retained = retainFilmEndingForDelivery(all, [{ ...leader, videoStatus: 'pending' }, follower]);
  assert.equal(retained[0], first);
  assert.equal(retained[2], follower);
  assert.equal(retained[1].videoEndingWarning, FILM_ENDING_ASR_SKIPPED_WARNING, 'use live receipt, not stale planned state');
  for (const videoStatus of ['pending', 'generating', 'failed']) {
    const incomplete = [first, { ...leader, videoStatus }, follower];
    assert.equal(retainFilmEndingForDelivery(incomplete, [leader, follower]), incomplete);
  }
});

test('automatic Story/Series production has no ASR request or paid ending-repair branch', () => {
  const page = readFileSync(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /commitStoryboards\(items => retainFilmEndingForDelivery\(items, group\)\)/);
  assert.doesNotMatch(page, /audit-video-ending|prepareFilmEndingRepair|filmEndingDisposition|MAX_ENDING_REPAIRS|核验整片末镜最后一秒/);
  assert.match(page, /isCompletedPlannedVideoSegment/, 'keep paid receipt reuse');
  assert.match(page, /恢复全部视频片段用于合成/, 'keep full export recovery');
  assert.match(FILM_ENDING_ASR_SKIPPED_WARNING, /ASR/);
  assert.match(FILM_ENDING_ASR_SKIPPED_WARNING, /跳过/);
  assert.doesNotMatch(FILM_ENDING_ASR_SKIPPED_WARNING, /通过|完成.*校验/);
});

test('only film ending receives extra headroom, and preview/request durations are idempotent', () => {
  assert.equal(filmEndingDuration(6, false), 6);
  assert.equal(filmEndingDuration(6, true), 8);
  assert.equal(filmEndingDuration(6, true, 8), 8);
  assert.equal(filmEndingDuration(6, true, 8, 11), 11);
  assert.equal(filmEndingDuration(6, false, 6, 11), 6);
  assert.equal(filmEndingDuration(14, true), 15);
});
