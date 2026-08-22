import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDirectorBatches, normalizeDirectorShots } from '../lib/pipeline/storyDirector.ts';
import { extractJson } from '../lib/pipeline/json.ts';
import { buildStoryBeatBatches, normalizeStoryOutline } from '../lib/pipeline/storyWriter.ts';
import { buildStoryBeatBatchPrompt, buildStoryOutlinePrompt } from '../lib/pipeline/storyWriterPrompt.ts';

const outlineSequence = (id, start, count) => ({
  id,
  locationId: `${id}_location`,
  sceneGoal: `complete ${id}`,
  entryState: `enter ${id}`,
  exitState: `exit ${id}`,
  shotCount: count,
  beatMap: Array.from({ length: count }, (_, offset) => ({
    index: start + offset,
    actionGoal: `${id} action ${offset + 1}`,
    cause: `${id} cause ${offset + 1}`,
    consequence: `${id} consequence ${offset + 1}`,
    emotionalTurn: `${id} turn ${offset + 1}`,
    requiredLine: '',
  })),
});

test('normalizes the global map to exact continuous indexes and rejects a wrong quota', () => {
  const outline = normalizeStoryOutline({
    title: 'Long film',
    sequences: [outlineSequence('seq-1', 20, 12), outlineSequence('seq-2', 50, 6)],
  }, 18);

  assert.deepEqual(outline.sequences.flatMap(sequence => sequence.beatMap.map(beat => beat.index)), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.throws(() => normalizeStoryOutline({ sequences: [outlineSequence('seq-1', 1, 8)] }, 9), /返回了 8 个镜头地图/);
});

test('requires every outline dialogue line to retain a valid uploaded speaker', () => {
  const invalid = outlineSequence('seq-1', 1, 9);
  invalid.beatMap[0].requiredLine = '我妹妹还在里面。';
  invalid.beatMap[0].requiredSpeaker = '临时少年';
  assert.throws(
    () => normalizeStoryOutline({ sequences: [invalid] }, 9, ['人鱼公主']),
    /没有有效 requiredSpeaker/,
  );

  invalid.beatMap[0].requiredSpeaker = '人鱼公主';
  const outline = normalizeStoryOutline({ sequences: [invalid] }, 9, ['人鱼公主']);
  assert.equal(outline.sequences[0].beatMap[0].requiredSpeaker, '人鱼公主');
});

test('screenplay batches never exceed nine shots and never cross a sequence boundary', () => {
  const outline = normalizeStoryOutline({
    sequences: [outlineSequence('seq-1', 1, 12), outlineSequence('seq-2', 13, 6)],
  }, 18);
  const batches = buildStoryBeatBatches(outline);

  assert.deepEqual(batches.map(batch => batch.beatMap.length), [9, 3, 6]);
  assert.deepEqual(batches.map(batch => batch.sequence.id), ['seq-1', 'seq-1', 'seq-2']);
  assert.ok(batches.every(batch => batch.beatMap.length <= 9));
});

test('outline and screenplay prompts keep story architecture separate from visual direction', () => {
  const outlinePrompt = buildStoryOutlinePrompt({
    synopsis: 'A must cross the city before dawn.',
    characters: [{ name: 'A', description: 'courier' }],
    objects: [],
    language: 'en',
    targetShotCount: 18,
  });
  const outline = normalizeStoryOutline({
    title: 'Before Dawn',
    sequences: [outlineSequence('seq-1', 1, 9), outlineSequence('seq-2', 10, 9)],
  }, 18);
  const batchPrompt = buildStoryBeatBatchPrompt({
    synopsis: 'A must cross the city before dawn.',
    outline,
    sequence: outline.sequences[0],
    beatMap: outline.sequences[0].beatMap,
    characters: [{ name: 'A', description: 'courier' }],
    objects: [],
    language: 'en',
  });

  assert.match(outlinePrompt, /只做【全片故事骨架与镜头地图】/);
  assert.match(outlinePrompt, /不要写详细分镜、摄影 prompt/);
  assert.match(batchPrompt, /不生成摄影内容/);
  assert.match(batchPrompt, /严格输出 9 个 beats/);
});

test('director batches mirror screenplay boundaries and remain capped at nine', () => {
  const beats = Array.from({ length: 18 }, (_, index) => ({ index: index + 1 }));
  const storyPlan = {
    sequences: [
      { id: 'seq-1', beats: beats.slice(0, 12) },
      { id: 'seq-2', beats: beats.slice(12) },
    ],
  };
  const batches = buildDirectorBatches(storyPlan);
  assert.deepEqual(batches.map(batch => batch.length), [9, 3, 6]);
  assert.deepEqual(batches.map(batch => batch.map(beat => beat.index)), [
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [10, 11, 12],
    [13, 14, 15, 16, 17, 18],
  ]);
});

test('JSON extraction preserves a one-item array instead of reducing it to its object', () => {
  const response = 'Here is the result:\n```json\n[{"index":1,"description":"shot","prompt":"image"}]\n```';
  const parsed = extractJson(response);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].index, 1);
});

test('JSON extraction handles nested braces in strings and ignores earlier non-JSON brackets', () => {
  const response = 'Note [not json]. Result: [{"description":"door {opens}","prompt":"camera [moves]"}] done';
  assert.deepEqual(extractJson(response), [{ description: 'door {opens}', prompt: 'camera [moves]' }]);
});

test('director normalization accepts provider wrappers and a direct object for one-shot batches', () => {
  const shot = { index: 1, description: 'shot', prompt: 'image' };
  assert.deepEqual(normalizeDirectorShots([shot], 1), [shot]);
  assert.deepEqual(normalizeDirectorShots({ shots: [shot] }, 1), [shot]);
  assert.deepEqual(normalizeDirectorShots({ storyboards: [shot] }, 1), [shot]);
  assert.deepEqual(normalizeDirectorShots({ data: { shot } }, 1), [shot]);
  assert.deepEqual(normalizeDirectorShots(shot, 1), [shot]);
  assert.deepEqual(normalizeDirectorShots(shot, 2), []);
});
