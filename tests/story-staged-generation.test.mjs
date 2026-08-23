import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDirectorBatches, normalizeDirectorShots, stripExactDialogueFromDescription, validateDirectorShots } from '../lib/pipeline/storyDirector.ts';
import { extractJson } from '../lib/pipeline/json.ts';
import { applySourceDialogueAuthority, buildStoryBeatBatches, expandStoryCharacters, filterVisibleStorySpeech, normalizeStoryOutline, parseSourceDialogueByShot } from '../lib/pipeline/storyWriter.ts';
import { buildStoryBeatBatchPrompt, buildStoryOutlinePrompt } from '../lib/pipeline/storyWriterPrompt.ts';

const outlineSequence = (id, start, count) => ({
  id,
  locationId: `${id}_location`,
  sceneGoal: `complete ${id}`,
  dramaticQuestion: `will ${id} change the situation?`,
  turningPoint: `${id} decisive choice`,
  exitHook: `${id} unresolved consequence`,
  audienceEntry: `${id} prior knowledge`,
  audienceExit: `${id} changed understanding`,
  entryState: `enter ${id}`,
  exitState: `exit ${id}`,
  shotCount: count,
  beatMap: Array.from({ length: count }, (_, offset) => ({
    index: start + offset,
    actionGoal: `${id} action ${offset + 1}`,
    cause: `${id} cause ${offset + 1}`,
    consequence: `${id} consequence ${offset + 1}`,
    emotionalTurn: `${id} turn ${offset + 1}`,
    informationGain: `${id} information ${offset + 1}`,
    dialoguePurpose: offset % 3 === 0 ? 'question' : 'visual_only',
    montageRole: offset === count - 1 ? 'consequence' : 'development',
    audienceQuestion: `${id} question ${offset + 1}`,
    requiredLine: '',
  })),
});

const outlineDocument = (sequences, extra = {}) => ({
  title: 'Long film',
  centralDramaticQuestion: 'Will the protagonist succeed without losing what matters?',
  audiencePromise: 'A causal journey with an emotional payoff.',
  dialogueArc: 'question → challenge → decision → payoff',
  montageStrategy: 'causal compression with motivated contrast',
  sequences,
  ...extra,
});

test('normalizes the global map to exact continuous indexes and rejects a wrong quota', () => {
  const outline = normalizeStoryOutline(outlineDocument([
    outlineSequence('seq-1', 20, 12), outlineSequence('seq-2', 50, 6),
  ]), 18);

  assert.deepEqual(outline.sequences.flatMap(sequence => sequence.beatMap.map(beat => beat.index)), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.throws(() => normalizeStoryOutline(outlineDocument([outlineSequence('seq-1', 1, 8)]), 9), /返回了 8 个镜头地图/);
});

test('normalizes common provider wrappers around the screenplay outline', () => {
  const outline = outlineDocument([outlineSequence('seq-1', 1, 9)]);
  for (const wrapped of [
    { storyPlan: outline },
    { data: { outline } },
    { result: { story: outline } },
    [outline],
  ]) {
    assert.equal(normalizeStoryOutline(wrapped, 9).sequences[0].beatMap.length, 9);
  }
});

test('requires every outline dialogue line to retain a valid uploaded speaker', () => {
  const invalid = outlineSequence('seq-1', 1, 9);
  invalid.beatMap[0].requiredLine = '我妹妹还在里面。';
  invalid.beatMap[0].requiredSpeaker = '临时少年';
  assert.throws(
    () => normalizeStoryOutline(outlineDocument([invalid]), 9, ['人鱼公主']),
    /没有有效 requiredSpeaker/,
  );

  invalid.beatMap[0].requiredSpeaker = '人鱼公主';
  const outline = normalizeStoryOutline(outlineDocument([invalid]), 9, ['人鱼公主']);
  assert.equal(outline.sequences[0].beatMap[0].requiredSpeaker, '人鱼公主');
});

test('outline dialogue purpose requires an explicit uploaded speaker', () => {
  const sequence = outlineSequence('seq-1', 1, 9);
  sequence.beatMap[0].dialoguePurpose = 'challenge';
  sequence.beatMap[0].requiredSpeaker = '';
  sequence.beatMap[1].dialoguePurpose = 'question';
  sequence.beatMap[1].requiredSpeaker = '人鱼公主';
  const outline = normalizeStoryOutline(outlineDocument([sequence]), 9, ['人鱼公主']);
  assert.equal(outline.sequences[0].beatMap[0].dialoguePurpose, 'visual_only');
  assert.equal(outline.sequences[0].beatMap[1].dialoguePurpose, 'question');
});

test('screenplay speech keeps visible uploaded voices and drops temporary-character additions', () => {
  assert.deepEqual(filterVisibleStorySpeech([
    { character: '人鱼公主', exactLine: 'Who controls the tide?' },
    { character: 'Tide Officer', exactLine: 'No one.' },
  ], ['人鱼公主'], ['人鱼公主']), [
    { character: '人鱼公主', exactLine: 'Who controls the tide?' },
  ]);
});

test('explicit screenplay speakers become text-defined cast while the sole protagonist alias maps to the uploaded card', () => {
  const expanded = expandStoryCharacters(`
SHOT 01 | Lanxi works | dialogue: Lanxi: “Almost.”
SHOT 02 | A-Luo enters | dialogue: A-Luo: “Rest.” Lanxi: “I can't.”
SHOT 03 | ending | dialogue: Narrator: “The tide returns.” Tide Officer: “No one.”
`, [{ name: '人鱼公主', description: 'uploaded mermaid princess card' }]);

  assert.equal(expanded.aliases.Lanxi, '人鱼公主');
  assert.match(expanded.canonicalSynopsis, /人鱼公主: “Almost\.”/);
  assert.deepEqual(expanded.characters.map(character => character.name), ['人鱼公主', 'A-Luo', 'Tide Officer']);
  assert.deepEqual(filterVisibleStorySpeech([
    { character: 'A-Luo', exactLine: 'Rest.' },
  ], ['人鱼公主', 'A-Luo'], expanded.characters.map(character => character.name)), [
    { character: 'A-Luo', exactLine: 'Rest.' },
  ]);
});

test('source shot dialogue is authoritative, preserves ordered exchanges, and excludes narration', () => {
  const source = `
SHOT 05 | garden | dialogue: A-Luo: “Why?” Lanxi: “Someone has to.”
SHOT 25 | reef | dialogue: Old Sea Turtle: “Is anyone looking for you?” Lanxi: “No.” Old Sea Turtle: “Then watch the sea.”
SHOT 27 | sea | dialogue: Lanxi: “Let it come.” Narrator: “The tide returns.”
`;
  const expanded = expandStoryCharacters(source, [{ name: '人鱼公主', description: 'card' }]);
  const parsed = parseSourceDialogueByShot(expanded.canonicalSynopsis, expanded.characters.map(character => character.name));
  assert.deepEqual(parsed.get(25), [
    { character: 'Old Sea Turtle', text: 'Is anyone looking for you?' },
    { character: '人鱼公主', text: 'No.' },
    { character: 'Old Sea Turtle', text: 'Then watch the sea.' },
  ]);
  assert.deepEqual(parsed.get(27), [{ character: '人鱼公主', text: 'Let it come.' }]);

  const outline = normalizeStoryOutline(outlineDocument([outlineSequence('seq-1', 1, 27)]), 27, expanded.characters.map(character => character.name));
  applySourceDialogueAuthority(outline, expanded.canonicalSynopsis, expanded.characters.map(character => character.name));
  assert.deepEqual(outline.sequences[0].beatMap[24].requiredDialogueLines, parsed.get(25));
  assert.deepEqual(outline.sequences[0].beatMap[26].requiredDialogueLines, parsed.get(27));
});

test('screenplay batches never exceed nine shots and never cross a sequence boundary', () => {
  const outline = normalizeStoryOutline(outlineDocument([
    outlineSequence('seq-1', 1, 12), outlineSequence('seq-2', 13, 6),
  ]), 18);
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
  const outline = normalizeStoryOutline(outlineDocument([
    outlineSequence('seq-1', 1, 9), outlineSequence('seq-2', 10, 9),
  ], { title: 'Before Dawn' }), 18);
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
  assert.match(outlinePrompt, /informationGain/);
  assert.match(outlinePrompt, /dialogueArc/);
  assert.match(batchPrompt, /不生成摄影内容/);
  assert.match(batchPrompt, /严格输出 9 个 beats/);
  assert.match(batchPrompt, /一镜通常有 0–2 条有序台词/);
  assert.match(batchPrompt, /requiredDialogueLines/);
  assert.match(batchPrompt, /进入动作→加速\/施力→明确触点或决定→0\.25–0\.6 秒可读结果/);
  assert.match(batchPrompt, /每个镜尾必须留下一个可被下一镜接住的具体交棒/);
  assert.match(batchPrompt, /transition 固定写 "cut"/);
  assert.match(batchPrompt, /不使用 dissolve、fade 或 wipe 特效/);
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

test('director validation rejects language contamination and dialogue copied into visual direction', () => {
  const beat = {
    index: 1,
    speech: [{ character: '人鱼公主', exactLine: 'Today, let it come on its own.' }],
  };
  assert.doesNotThrow(() => validateDirectorShots([
    { description: '[Medium shot] 人鱼公主 lowers her hand and turns toward the sea.', prompt: 'image prompt' },
  ], [beat], 'array(1)', 'en', ['人鱼公主']));
  assert.throws(() => validateDirectorShots([
    { description: '[中景] 人鱼公主 lowers her hand.', prompt: 'image prompt' },
  ], [beat], 'array(1)', 'en', ['人鱼公主']), /未按英文输出/);
  assert.throws(() => validateDirectorShots([
    { description: '[中景] 人鱼公主 alarm 后转身。', prompt: 'image prompt' },
  ], [beat], 'array(1)', 'zh', ['人鱼公主']), /未解释的英文词/);
  assert.throws(() => validateDirectorShots([
    { description: '[Medium shot] 人鱼公主 says, “Today, let it come on its own.”', prompt: 'image prompt' },
  ], [beat], 'array(1)', 'en', ['人鱼公主']), /重复了权威台词/);
  assert.equal(
    stripExactDialogueFromDescription(
      '[Medium shot] 人鱼公主 says, “Today, let it come on its own.” She turns to sea.',
      beat,
    ),
    '[Medium shot] 人鱼公主 She turns to sea.',
  );
  assert.equal(
    stripExactDialogueFromDescription('She whispers “Again—” and reaches forward.', {
      speech: [{ character: '人鱼公主', exactLine: 'Again.' }],
    }),
    'She and reaches forward.',
  );
  assert.equal(stripExactDialogueFromDescription('She удерж reaches forward.'), 'She reaches forward.');
});
