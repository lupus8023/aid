import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateSegmentTimeline,
  estimateVideoSegmentSeconds,
  isCompletedVideoSegment,
  suggestVideoSegments,
  validateVideoSegment,
} from '../lib/videoSegments.ts';

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
