import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateSegmentTimeline,
  estimateVideoSegmentSeconds,
  isCompletedVideoSegment,
  persistedVideoClipCount,
  restoredStoryStep,
  suggestVideoSegments,
  validateVideoSegment,
} from '../lib/videoSegments.ts';
import {
  CONTINUITY_HANDOFF_LEAD_SECONDS,
  CONTINUITY_HEAD_TRIM_SECONDS,
} from '../lib/videoContinuity.ts';

const shot = (sceneNumber, extra = {}) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  description: `shot ${sceneNumber}`,
  prompt: '',
  characters: [],
  status: 'completed',
  imageUrl: `https://example.com/${sceneNumber}.jpg`,
  durationHint: 5,
  sequenceId: 'seq-1',
  locationId: 'loc-1',
  ...extra,
});

test('suggests compact groups without exceeding four storyboards', () => {
  const groups = suggestVideoSegments(Array.from({ length: 9 }, (_, index) => shot(index + 1)));
  assert.deepEqual(groups.map(group => group.length), [4, 4, 1]);
  assert.ok(groups.every(group => estimateVideoSegmentSeconds(group) <= 15));
});

test('starts a new segment when sequence or location changes', () => {
  const groups = suggestVideoSegments([
    shot(1), shot(2),
    shot(3, { sequenceId: 'seq-2', locationId: 'loc-2' }),
    shot(4, { sequenceId: 'seq-2', locationId: 'loc-2' }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1, 2], [3, 4]]);
});

test('keeps up to three timed dialogue beats together and splits before the fourth', () => {
  const groups = suggestVideoSegments([
    shot(1, { characters: ['A'], dialogueLines: [{ character: 'A', text: '第一句。' }] }),
    shot(2, { characters: ['B'], dialogueLines: [{ character: 'B', text: '第二句。' }] }),
    shot(3, { characters: ['A'], dialogueLines: [{ character: 'A', text: '第三句。' }] }),
    shot(4, { characters: ['C'], dialogueLines: [{ character: 'C', text: '第四句。' }] }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1, 2, 3], [4]]);
  assert.equal(validateVideoSegment(groups[0]), undefined);
  assert.match(validateVideoSegment([shot(1, { characters: ['A'], imageUrl: 'x', dialogueLines: [{ character: 'A', text: '一。' }] }), shot(2, { characters: ['B'], imageUrl: 'x', dialogueLines: [{ character: 'B', text: '二。' }] }), shot(3, { characters: ['C'], imageUrl: 'x', dialogueLines: [{ character: 'C', text: '三。' }] }), shot(4, { characters: ['D'], imageUrl: 'x', dialogueLines: [{ character: 'D', text: '四。' }] })]), /最多安排 3 条/);
});

test('rejects non-contiguous or oversized manual groups', () => {
  assert.match(validateVideoSegment([shot(1), shot(3)]), /连续分镜/);
  assert.match(validateVideoSegment([1, 2, 3, 4, 5].map(number => shot(number))), /最多选择 4/);
});

test('timeline fills the entire H3 duration without gaps', () => {
  const timeline = allocateSegmentTimeline([shot(1), shot(2), shot(3), shot(4)], 12);
  assert.equal(timeline[0].start, 0);
  assert.equal(timeline.at(-1).end, 12);
  timeline.slice(1).forEach((item, index) => assert.equal(item.start, timeline[index].end));
});

test('does not mistake legacy per-shot videos for a completed grouped segment', () => {
  const legacy = [
    shot(1, { videoStatus: 'completed', videoUrl: 'blob:legacy-1' }),
    shot(2, { videoStatus: 'completed', videoUrl: 'blob:legacy-2' }),
  ];
  assert.equal(isCompletedVideoSegment(legacy), false);

  const current = legacy.map((item, index) => ({
    ...item,
    videoUrl: index === 0 ? 'blob:segment' : undefined,
    videoSegmentId: 'segment-1',
    videoSegmentStoryboardIds: index === 0 ? ['scene-1', 'scene-2'] : undefined,
  }));
  assert.equal(isCompletedVideoSegment(current), true);
});

test('restores a saved H3 project directly to export after refresh', () => {
  const saved = [shot(1), shot(2)].map((item, index) => ({
    ...item,
    videoStatus: 'completed',
    videoSegmentId: 'segment-1',
    videoSegmentStoryboardIds: index === 0 ? ['scene-1', 'scene-2'] : undefined,
    videoCacheKey: index === 0 ? 'storyboard-video:project-1:scene-1' : undefined,
  }));
  assert.equal(restoredStoryStep(saved), 6);
  assert.equal(persistedVideoClipCount(saved), 1);
  assert.equal(restoredStoryStep(saved.map(item => ({ ...item, videoCacheKey: undefined }))), 5);
  assert.equal(restoredStoryStep(saved.map((item, index) => index ? item : { ...item, imageUrl: undefined })), 4);
});

test('uses a moving continuity handoff and trims the H3 restart', () => {
  assert.ok(CONTINUITY_HANDOFF_LEAD_SECONDS > CONTINUITY_HEAD_TRIM_SECONDS);
  assert.ok(CONTINUITY_HANDOFF_LEAD_SECONDS <= 0.3);
  assert.ok(CONTINUITY_HEAD_TRIM_SECONDS >= 0.12);
});
