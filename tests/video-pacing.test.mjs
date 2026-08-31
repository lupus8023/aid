import assert from 'node:assert/strict';
import test from 'node:test';

import {
  averagePacingRate,
  buildSmartPacingSections,
  classifyStoryboardPacing,
  effectiveClipDuration,
  outputOffsetForSourceTime,
  playbackRateAtSourceTime,
  sourceTimeForOutputOffset,
  clippedPacingSections,
  withFilmEndingPacing,
} from '../lib/videoPacing.ts';

function storyboard(overrides = {}) {
  return {
    id: overrides.id || `shot-${Math.random()}`,
    sceneNumber: overrides.sceneNumber || 1,
    description: '',
    prompt: '',
    characters: [],
    status: 'completed',
    durationHint: 4,
    ...overrides,
  };
}

test('classifies emotional performance, dialogue and transitions before assigning speed', () => {
  assert.equal(classifyStoryboardPacing(storyboard({
    clipType: 'performance',
    shotSize: '极近特写',
    action: '她克制地抬眼，一滴眼泪缓慢滑落。',
  })).kind, 'emotion');

  assert.equal(classifyStoryboardPacing(storyboard({
    clipType: 'dialogue',
    characters: ['兰曦'],
    speech: [{ character: '兰曦', exactLine: '门正在关闭。' }],
  })).kind, 'dialogue');

  assert.equal(classifyStoryboardPacing(storyboard({ clipType: 'establishing' })).kind, 'transition');
  assert.equal(classifyStoryboardPacing(storyboard({ clipType: 'action', action: '她快速游向洞口。' })).kind, 'action');
});

test('only film ending keeps its last source second, and reordering clears the former ending', () => {
  const clips = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1, duration: 6, trimStart: 0, trimEnd: 0,
    pacingSections: [{ sourceStart: 0, sourceEnd: 6, rate: 1.25, kind: 'action', reason: 'action' }],
  }));
  const protectedClips = withFilmEndingPacing(clips);
  for (const clip of protectedClips.slice(0, -1)) {
    assert.equal(effectiveClipDuration(clip), 4.8);
    assert.equal(clippedPacingSections(clip).length, 1);
  }
  const last = protectedClips.at(-1);
  assert.equal(effectiveClipDuration(last), 5);
  assert.equal(effectiveClipDuration(last) - outputOffsetForSourceTime(last, 5), 1);
  assert.equal(sourceTimeForOutputOffset(last, 4.5), 5.5);
  assert.deepEqual(withFilmEndingPacing(protectedClips), protectedClips);
  const reordered = withFilmEndingPacing([last, ...protectedClips.slice(0, -1)]);
  assert.equal(effectiveClipDuration(reordered[0]), 4.8);
  assert.equal(effectiveClipDuration(reordered.at(-1)), 5);
  assert.equal(clips[17].preserveEndingSeconds, undefined);
});

test('ending protection respects trimmed boundaries, slow motion and genuinely short footage', () => {
  const [trimmed] = withFilmEndingPacing([{
    duration: 6, trimStart: 1, trimEnd: 1,
    pacingSections: [{ sourceStart: 0, sourceEnd: 6, rate: 1.25, kind: 'action', reason: 'action' }],
  }]);
  assert.equal(Number(effectiveClipDuration(trimmed).toFixed(3)), 3.4);
  assert.equal(clippedPacingSections(trimmed).at(-1).sourceEnd, 5);
  const [slow] = withFilmEndingPacing([{ ...trimmed, pacingSections: [{ sourceStart: 0, sourceEnd: 6, rate: 0.8, kind: 'emotion', reason: 'slow' }] }]);
  assert.equal(effectiveClipDuration(slow), 5);
  const [short] = withFilmEndingPacing([{ ...trimmed, duration: 0.5, trimStart: 0, trimEnd: 0 }]);
  assert.equal(effectiveClipDuration(short), 0.5);
});

test('standard pacing protects emotion while accelerating narrative and action beats', () => {
  const storyboards = [
    storyboard({ id: 'emotion', sceneNumber: 1, clipType: 'performance', shotSize: '特写', action: '她沉默凝视。' }),
    storyboard({ id: 'narrative', sceneNumber: 2, clipType: 'reaction', action: '她转身观察洞穴。' }),
    storyboard({ id: 'action', sceneNumber: 3, clipType: 'action', action: '她冲向洞口。' }),
  ];
  const sections = buildSmartPacingSections(storyboards, 12, 'standard');
  assert.deepEqual(sections.map(section => section.rate), [1.02, 1.16, 1.22]);
  assert.equal(sections[0].sourceStart, 0);
  assert.equal(sections.at(-1).sourceEnd, 12);
});

test('pacing duration and source/output time mapping stay reversible after trimming', () => {
  const clip = {
    duration: 10,
    trimStart: 1,
    trimEnd: 1,
    pacingSections: [
      { sourceStart: 0, sourceEnd: 4, rate: 1, kind: 'emotion', reason: 'protect' },
      { sourceStart: 4, sourceEnd: 10, rate: 1.25, kind: 'action', reason: 'accelerate' },
    ],
  };
  assert.equal(Number(effectiveClipDuration(clip).toFixed(3)), 7);
  assert.equal(Number(averagePacingRate(clip).toFixed(3)), 1.143);
  assert.equal(playbackRateAtSourceTime(clip, 2), 1);
  assert.equal(playbackRateAtSourceTime(clip, 7), 1.25);

  const outputOffset = outputOffsetForSourceTime(clip, 7);
  assert.equal(Number(outputOffset.toFixed(3)), 5.4);
  assert.equal(Number(sourceTimeForOutputOffset(clip, outputOffset).toFixed(3)), 7);
});

test('original mode covers a complete generated segment at 1x', () => {
  const sections = buildSmartPacingSections([storyboard()], 6.237, 'original');
  assert.deepEqual(sections, [{
    sourceStart: 0,
    sourceEnd: 6.237,
    rate: 1,
    kind: 'original',
    reason: '保留原始速度',
  }]);
});
