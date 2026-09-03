import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDirectorBatches, buildDirectorPrompt, normalizeDirectorShots, stripExactDialogueFromDescription, validateDirectorShots } from '../lib/pipeline/storyDirector.ts';
import { extractJson } from '../lib/pipeline/json.ts';
import { applySourceDialogueAuthority, applyStoryDialogueManuscript, buildStoryBeatBatches, expandStoryCharacters, filterVisibleStorySpeech, missingSourceDialogueLines, normalizeStoryOutline, normalizeStorySpine, normalizedBeatConflict, normalizedBeatNextCause, parseSourceDialogueByShot, sanitizeStoryPlan, structuredRetryCorrection, validateStorySequenceMap } from '../lib/pipeline/storyWriter.ts';
import { buildSourceShotAdaptationMap, buildStoryBeatBatchPrompt, buildStoryDialogueManuscriptPrompt, buildStoryOutlinePrompt, buildStorySequenceMapPrompt, buildStorySpinePrompt } from '../lib/pipeline/storyWriterPrompt.ts';
import { apimartErrorSummary } from '../lib/apimart.ts';

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
    editBridge: `${id} result ${offset + 1} causally triggers the next action and changes audience understanding`,
    audienceQuestion: `${id} question ${offset + 1}`,
    requiredLine: '',
  })),
});

const outlineDocument = (sequences, extra = {}) => {
  const beatCount = sequences.flatMap(sequence => sequence.beatMap).length;
  const finalBeat = sequences.at(-1)?.beatMap.at(-1);
  if (finalBeat) finalBeat.editBridge = 'terminal image: the resolved new life remains visibly stable';
  return {
    title: 'Long film',
    centralDramaticQuestion: 'Will the protagonist succeed without losing what matters?',
    audiencePromise: 'A causal journey with an emotional payoff.',
    dialogueArc: 'question → challenge → decision → payoff',
    montageStrategy: 'causal compression with motivated contrast',
    structure: [
      ['opening', 1],
      ['inciting_incident', Math.max(1, Math.round(beatCount * 0.15))],
      ['first_threshold', Math.max(1, Math.round(beatCount * 0.28))],
      ['midpoint_reversal', Math.max(1, Math.round(beatCount * 0.5))],
      ['crisis_choice', Math.max(1, Math.round(beatCount * 0.72))],
      ['climax_proof', Math.max(1, Math.round(beatCount * 0.9))],
      ['resolution', Math.max(1, beatCount)],
    ].map(([name, shotIndex]) => ({ name, shotIndex, event: `${name} visible event`, audienceShift: `${name} changes audience understanding` })),
    sequences,
    ...extra,
  };
};

test('normalizes the global map to exact continuous indexes and rejects a wrong quota', () => {
  const outline = normalizeStoryOutline(outlineDocument([
    outlineSequence('seq-1', 20, 12), outlineSequence('seq-2', 50, 6),
  ]), 18);

  assert.deepEqual(outline.sequences.flatMap(sequence => sequence.beatMap.map(beat => beat.index)), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.throws(() => normalizeStoryOutline(outlineDocument([outlineSequence('seq-1', 1, 8)]), 9), /返回了 8 个镜头地图/);
});

test('stages a long outline as a small spine and exact-count sequence maps', () => {
  const spine = normalizeStorySpine({
    centralDramaticQuestion: 'Will A finish?',
    audiencePromise: 'A causal payoff.',
    dialogueArc: 'question to answer',
    montageStrategy: 'causal cuts',
    structure: [
      ['opening', 1], ['inciting_incident', 3], ['first_threshold', 5], ['midpoint_reversal', 9],
      ['crisis_choice', 13], ['climax_proof', 17], ['resolution', 18],
    ].map(([name, shotIndex]) => ({ name, shotIndex, event: `${name} event`, audienceShift: `${name} shift` })),
    sequences: [
      { id: 'seq-1', locationId: 'room', shotCount: 2 },
      { id: 'seq-2', locationId: 'street', shotCount: 4 },
    ],
  }, 18);
  assert.equal(spine.sequences.reduce((total, sequence) => total + sequence.shotCount, 0), 18);

  const rawBeats = Array.from({ length: 6 }, (_, offset) => ({
    actionGoal: `action ${offset}`,
    cause: `cause ${offset}`,
    consequence: `consequence ${offset}`,
    emotionalTurn: `turn ${offset}`,
    informationGain: `information ${offset}`,
    dialoguePurpose: 'visual_only',
    montageRole: 'development',
    editBridge: `causal action ${offset}; audienceInference: change ${offset}`,
    audienceQuestion: `question ${offset}`,
  }));
  const beats = validateStorySequenceMap({ data: { beatMap: rawBeats } }, 7, 6, ['A']);
  assert.deepEqual(beats.map(beat => beat.index), [7, 8, 9, 10, 11, 12]);
  assert.throws(() => validateStorySequenceMap({ beatMap: rawBeats.slice(0, 4) }, 7, 6, ['A']), /返回 4 条/);
});

test('long-story prompts separate spine allocation from bounded beat-map output', () => {
  const shared = {
    synopsis: 'A crosses the city and returns with proof.',
    characters: [{ name: 'A', description: 'adult investigator' }],
    objects: [],
    language: 'en',
    targetShotCount: 16,
  };
  const spinePrompt = buildStorySpinePrompt(shared);
  assert.match(spinePrompt, /shotCount.*16|合计必须严格等于 16/s);
  assert.doesNotMatch(spinePrompt, /"beatMap"\s*:/);

  const mapPrompt = buildStorySequenceMapPrompt({
    ...shared,
    spine: { title: 'Proof', sequences: [{ id: 'seq-1', shotCount: 6 }] },
    sequence: { id: 'seq-1', shotCount: 6 },
    startIndex: 7,
    shotCount: 6,
  });
  assert.match(mapPrompt, /镜头 7–12/);
  assert.match(mapPrompt, /beatMap 恰好 6 条/);
});

test('detailed screenplay contract creates actor-facing performance cues per visible character', () => {
  const prompt = buildStoryBeatBatchPrompt({
    synopsis: 'A refuses to abandon B at the locked gate.',
    outline: outlineDocument([outlineSequence('seq-1', 1, 9)]),
    sequence: outlineSequence('seq-1', 1, 1),
    beatMap: [outlineSequence('seq-1', 1, 1).beatMap[0]],
    characters: [{ name: 'A', description: 'determined adult' }, { name: 'B', description: 'wary adult' }],
    objects: [],
    language: 'en',
  });
  assert.match(prompt, /"performance"/);
  assert.match(prompt, /micro|微表情/i);

  const plan = sanitizeStoryPlan({
    title: 'Performance',
    characters: [{ name: 'A' }],
    sequences: [{
      id: 'seq-1',
      beats: [{
        characters: ['A'],
        action: 'A plants one foot at the gate and holds the latch.',
        dramaticPurpose: 'A refuses to leave.',
        characterChange: 'fear settles into resolve',
        performance: [{
          character: 'A', objective: 'keep B inside', blocking: 'steps in and braces', gesture: 'one hand closes on the latch',
          expression: 'eyes flick to B, brow tightens, jaw settles', gaze: 'B to latch', breath: 'one held breath releases',
          reaction: 'does not yield when B pulls away', subtext: 'I will not lose you too',
        }],
      }],
    }],
  }, ['A'], [], '', 9);
  assert.equal(plan.sequences[0].beats[0].performance[0].character, 'A');
  assert.match(plan.sequences[0].beats[0].performance[0].expression, /brow tightens/);
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

test('treats the final beat as a terminal story state instead of inventing a sequel hook', () => {
  const finalAuthority = {
    index: 18,
    montageRole: 'resolution',
    consequence: 'The tide returns and the family can remain together.',
  };
  assert.match(normalizedBeatNextCause('', finalAuthority, 18, 'en'), /Terminal story state/);
  assert.equal(normalizedBeatNextCause('The bell summons them onward.', finalAuthority, 18, 'en'), 'The bell summons them onward.');
  assert.equal(normalizedBeatNextCause('', { ...finalAuthority, index: 17, montageRole: 'development' }, 18, 'en'), '');
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
  sequence.beatMap[1].dialogueTurns = [{
    speaker: '人鱼公主', function: 'question', contentGoal: '问清潮汐为何停止', respondsTo: '',
  }];
  const outline = normalizeStoryOutline(outlineDocument([sequence]), 9, ['人鱼公主']);
  assert.equal(outline.sequences[0].beatMap[0].dialoguePurpose, 'visual_only');
  assert.equal(outline.sequences[0].beatMap[1].dialoguePurpose, 'question');
});

test('dialogue turns recover their speaker and purpose instead of being silently downgraded', () => {
  const sequence = outlineSequence('seq-1', 1, 9);
  sequence.beatMap[0].dialoguePurpose = 'visual_only';
  sequence.beatMap[0].dialogueObligation = 'visual';
  sequence.beatMap[0].requiredSpeaker = '';
  sequence.beatMap[0].dialogueTurns = [{
    speaker: '人鱼公主', function: 'reveal', contentGoal: '说明潮门失控会淹没育婴区', respondsTo: '',
  }];
  const outline = normalizeStoryOutline(outlineDocument([sequence]), 9, ['人鱼公主']);
  const beat = outline.sequences[0].beatMap[0];
  assert.equal(beat.requiredSpeaker, '人鱼公主');
  assert.equal(beat.dialogueObligation, 'required');
  assert.equal(beat.dialoguePurpose, 'reveal');
  assert.equal(beat.dialogueTurns[0].contentGoal, '说明潮门失控会淹没育婴区');
});

test('adjacent answer beats inherit the question dialogue unit', () => {
  const sequence = outlineSequence('seq-1', 1, 9);
  sequence.beatMap[0].dialoguePurpose = 'question';
  sequence.beatMap[0].dialogueObligation = 'required';
  sequence.beatMap[0].dialogueUnitId = 'dlg-question';
  sequence.beatMap[0].dialogueTurns = [{ speaker: 'A', function: 'question', contentGoal: 'ask who opened the gate', respondsTo: '' }];
  sequence.beatMap[1].dialoguePurpose = 'answer';
  sequence.beatMap[1].dialogueObligation = 'required';
  sequence.beatMap[1].dialogueUnitId = 'dlg-model-invented-new-id';
  sequence.beatMap[1].dialogueTurns = [{ speaker: 'B', function: 'answer', contentGoal: 'admit opening the gate', respondsTo: 'ask who opened the gate' }];
  const outline = normalizeStoryOutline(outlineDocument([sequence]), 9, ['A', 'B']);
  assert.equal(outline.sequences[0].beatMap[1].dialogueUnitId, 'dlg-question');
});

test('screenplay speech keeps visible uploaded voices and drops temporary-character additions', () => {
  assert.deepEqual(filterVisibleStorySpeech([
    { character: '人鱼公主', exactLine: 'Who controls the tide?' },
    { character: 'Tide Officer', exactLine: 'No one.' },
  ], ['人鱼公主'], ['人鱼公主']), [
    { character: '人鱼公主', exactLine: 'Who controls the tide?' },
  ]);
});

test('required exact speech restores its visible speaker and can intentionally repeat', () => {
  const exactLine = 'Hold the western gate.';
  const plan = sanitizeStoryPlan({
    title: 'Voice contract',
    characters: [{ name: 'Tide Officer' }],
    sequences: [{
      id: 'seq-1',
      beats: [1, 2].map(index => ({
        index,
        characters: [],
        action: 'The Tide Officer addresses the crew.',
        dialogueObligation: 'required',
        speech: [{ character: 'Tide Officer', exactLine, source: 'user_exact', storyFunction: 'command' }],
      })),
    }],
  }, ['Tide Officer'], [], exactLine, 2);
  assert.deepEqual(plan.sequences.flatMap(sequence => sequence.beats.map(beat => beat.characters)), [
    ['Tide Officer'], ['Tide Officer'],
  ]);
  assert.deepEqual(plan.sequences.flatMap(sequence => sequence.beats.map(beat => beat.speech[0]?.exactLine)), [exactLine, exactLine]);
});

test('explicit screenplay speakers become text-defined cast while the sole protagonist alias maps to the uploaded card', () => {
  const expanded = expandStoryCharacters(`
SHOT 01 | Lanxi works | dialogue: Lanxi: “Almost.”
SHOT 02 | A-Luo enters | dialogue: A-Luo: “Rest.” Lanxi: “I can't.”
SHOT 03 | ending | dialogue: Narrator: “The tide returns.” Tide Officer: “No one.”
`, [{ name: '人鱼公主', description: 'uploaded mermaid princess card' }]);

  assert.equal(expanded.aliases.Lanxi, '人鱼公主');
  assert.match(expanded.canonicalSynopsis, /人鱼公主: “Almost\.”/);
  assert.match(expanded.canonicalSynopsis, /“I can't\.”/);
  assert.doesNotMatch(expanded.canonicalSynopsis, /“[^”]*人鱼公主[^”]*”/);
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
  assert.notEqual(outline.sequences[0].beatMap[24].dialogueTurns[0].function, 'user_exact');
});

test('adapting a numbered source screenplay keeps dialogue from the complete timeline', () => {
  const source = Array.from({ length: 27 }, (_, offset) => {
    const index = offset + 1;
    const dialogue = index === 1
      ? ' | dialogue: Lanxi: “I will hold the tide.”'
      : index === 2
      ? ' | dialogue: Tide Officer: “The gates are buckling.”'
      : index === 26
        ? ' | dialogue: Lanxi: “Today, let it come on its own.”'
        : ' | dialogue: NONE';
    return `SHOT ${String(index).padStart(2, '0')} | beat ${index}${dialogue}`;
  }).join('\n');
  const expanded = expandStoryCharacters(source, [{ name: '人鱼公主', description: 'card' }], 'en');
  const rewritten = outlineSequence('seq-1', 1, 18);
  const outline = normalizeStoryOutline(outlineDocument([rewritten]), 18, expanded.characters.map(character => character.name));
  applySourceDialogueAuthority(outline, expanded.canonicalSynopsis, expanded.characters.map(character => character.name));
  const allLines = outline.sequences.flatMap(sequence => sequence.beatMap.flatMap(beat => beat.requiredDialogueLines));
  assert.deepEqual(allLines, [
    { character: '人鱼公主', text: 'I will hold the tide.' },
    { character: 'Tide Officer', text: 'The gates are buckling.' },
    { character: '人鱼公主', text: 'Today, let it come on its own.' },
  ]);
  assert.equal(outline.sequences[0].beatMap[17].requiredDialogueLines[0].text, 'Today, let it come on its own.');
  assert.ok(outline.sequences[0].beatMap[17].sourceShotRefs.includes(26));
  assert.ok(outline.sequences[0].beatMap[17].sourceShotRefs.includes(27));
  assert.equal(buildSourceShotAdaptationMap(source, 18).length, 18);
  assert.deepEqual(missingSourceDialogueLines(outline, expanded.canonicalSynopsis, expanded.characters.map(character => character.name)), []);

  outline.sequences[0].beatMap[17].requiredDialogueLines = [];
  assert.deepEqual(missingSourceDialogueLines(outline, expanded.canonicalSynopsis, expanded.characters.map(character => character.name)), [
    { character: '人鱼公主', text: 'Today, let it come on its own.' },
  ]);
});

test('source-shot compression avoids merging adjacent dialogue beats beyond H3 timing', () => {
  const source = `
### SEQUENCE 1 — chamber
SHOT 01 | chamber | visual setup | dialogue: NONE
SHOT 02 | chamber | challenge | dialogue: A: “You have carried every gate since dawn, and your hands are already shaking while another warning reaches the chamber.”
SHOT 03 | chamber | refusal | dialogue: B: “I cannot leave while the whole city still believes only I can hold back the sea and guide every family home.”
SHOT 04 | chamber | visual consequence | dialogue: NONE
SHOT 05 | chamber | visual bridge | dialogue: NONE
SHOT 06 | chamber | visual payoff | dialogue: NONE`;
  const groups = buildSourceShotAdaptationMap(source, 4);
  assert.equal(groups.length, 4);
  assert.equal(groups.some(group => group.sourceShotRefs.includes(2) && group.sourceShotRefs.includes(3)), false);
});

test('a final resolution beat receives residual tension without inventing a new conflict', () => {
  assert.match(normalizedBeatConflict('', {
    index: 18,
    montageRole: 'resolution',
    emotionalTurn: 'Lanxi accepts freedom',
  }, 18, 'en'), /central conflict is resolved/i);
  assert.equal(normalizedBeatConflict('The gate still resists.', {
    index: 17,
    montageRole: 'escalation',
    emotionalTurn: '',
  }, 18, 'en'), 'The gate still resists.');
  assert.equal(normalizedBeatConflict('', {
    index: 17,
    montageRole: 'escalation',
    emotionalTurn: '',
  }, 18, 'en'), '');
});

test('protagonist aliases never mutate names spoken inside exact dialogue', () => {
  const source = `
SHOT 01 | wheel | dialogue: Lanxi: “I will hold it.”
SHOT 02 | chamber | dialogue: Tide Officer: “Princess Lanxi, the gates are buckling.”
SHOT 03 | channel | dialogue: Lanxi: “Open the gate.”
SHOT 11 | console | dialogue: A-Luo: “Lanxi!”
SHOT 23 | reef | dialogue: Lanxi: “Do I matter?” Old Sea Turtle: “You matter because you are Lanxi.”
`;
  const expanded = expandStoryCharacters(source, [{ name: '人鱼公主', description: 'card' }], 'en');
  const parsed = parseSourceDialogueByShot(expanded.canonicalSynopsis, expanded.characters.map(character => character.name));
  assert.deepEqual(parsed.get(2), [{ character: 'Tide Officer', text: 'Princess Lanxi, the gates are buckling.' }]);
  assert.deepEqual(parsed.get(11), [{ character: 'A-Luo', text: 'Lanxi!' }]);
  assert.deepEqual(parsed.get(23), [
    { character: '人鱼公主', text: 'Do I matter?' },
    { character: 'Old Sea Turtle', text: 'You matter because you are Lanxi.' },
  ]);
});

test('screenplay batches stay small enough for complete JSON and never cross a sequence boundary', () => {
  const outline = normalizeStoryOutline(outlineDocument([
    outlineSequence('seq-1', 1, 12), outlineSequence('seq-2', 13, 6),
  ]), 18);
  const batches = buildStoryBeatBatches(outline);

  assert.deepEqual(batches.map(batch => batch.beatMap.length), Array(18).fill(1));
  assert.deepEqual(batches.map(batch => batch.sequence.id), [...Array(12).fill('seq-1'), ...Array(6).fill('seq-2')]);
  assert.ok(batches.every(batch => batch.beatMap.length === 1));
});

test('dialogue-heavy screenplay batches split before the structured response becomes oversized', () => {
  const sequence = outlineSequence('seq-1', 1, 9);
  sequence.beatMap.forEach((beat, index) => {
    beat.dialoguePurpose = 'exchange';
    beat.dialogueTurns = [
      { speaker: 'A', function: 'question', contentGoal: `question ${index}`, respondsTo: '' },
      { speaker: 'B', function: 'answer', contentGoal: `answer ${index}`, respondsTo: `question ${index}` },
    ];
  });
  const outline = normalizeStoryOutline(outlineDocument([sequence]), 9, ['A', 'B']);
  const batches = buildStoryBeatBatches(outline);
  assert.deepEqual(batches.map(batch => batch.beatMap.length), Array(9).fill(1));
  assert.ok(batches.every(batch => batch.beatMap.flatMap(beat => beat.dialogueTurns).length <= 6));
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
    synopsis: 'UNRELATED_FULL_SOURCE_MARKER A must cross the city before dawn.',
    outline,
    sequence: outline.sequences[0],
    beatMap: outline.sequences[0].beatMap,
    characters: [{ name: 'A', description: 'courier' }],
    objects: [],
    language: 'en',
  });
  const directorPrompt = buildDirectorPrompt({
    storyPlan: {
      ...outlineDocument([], { sourceBrief: 'DIRECTOR_FULL_SOURCE_MARKER', title: 'Before Dawn' }),
      requirements: [], characters: [], sequences: [],
    },
    beats: [{ index: 1, action: 'A runs.', characters: ['A'], speech: [] }],
    batchNumber: 1,
    totalBatches: 1,
    characters: [{ name: 'A', description: 'courier' }],
    objects: [],
    language: 'en',
  });

  assert.match(outlinePrompt, /只做【全片故事骨架与镜头地图】/);
  assert.match(outlinePrompt, /不要写详细分镜、摄影 prompt/);
  assert.match(outlinePrompt, /informationGain/);
  assert.match(outlinePrompt, /dialogueArc/);
  assert.match(outlinePrompt, /midpoint_reversal/);
  assert.match(outlinePrompt, /后续形象与声音共用同一性别\/年龄/);
  assert.match(batchPrompt, /不生成摄影内容/);
  assert.doesNotMatch(batchPrompt, /UNRELATED_FULL_SOURCE_MARKER/);
  assert.match(batchPrompt, /严格输出 9 个 beats/);
  assert.match(batchPrompt, /先把相邻 beat 看成待装入同一个 H3 片段的视觉参考/);
  assert.match(batchPrompt, /一段允许多个不同人物依次说话/);
  assert.match(batchPrompt, /每个人物只能对应一个连续 speech 条目/);
  assert.match(batchPrompt, /requiredDialogueLines/);
  assert.match(batchPrompt, /进入动作→加速\/施力→明确触点或决定→0\.25–0\.6 秒可读结果/);
  assert.match(batchPrompt, /每个镜尾必须留下一个可被下一镜接住的具体交棒/);
  assert.match(batchPrompt, /transition 固定写 "cut"/);
  assert.match(batchPrompt, /不使用 dissolve、fade 或 wipe 特效/);
  assert.doesNotMatch(directorPrompt, /DIRECTOR_FULL_SOURCE_MARKER/);
  assert.match(directorPrompt, /只执行下方结构化合同/);
  assert.match(directorPrompt, /像向摄影师描述眼前这一刻/);
  assert.match(directorPrompt, /不要在成稿中罗列 PBR/);
  assert.match(directorPrompt, /剧本明确写出的无名背景侍从、群众可保留/);
  assert.match(directorPrompt, /约 55–95 个英文词/);
  assert.doesNotMatch(directorPrompt, /PHOTOGRAPHIC SURFACE AND OPTICS|radial iris fibers|IMAGE RESPONSE 必须/);
});

test('global dialogue manuscript locks complete spoken meaning before screenplay batches', () => {
  const sequence = outlineSequence('seq-1', 1, 9);
  sequence.beatMap[0].dialoguePurpose = 'decision';
  sequence.beatMap[0].dialogueObligation = 'required';
  sequence.beatMap[0].dialogueUnitId = 'dlg-1';
  sequence.beatMap[0].dialogueTurns = [{
    speaker: 'A', function: 'decision', contentGoal: 'A chooses to share control of the tide instead of carrying it alone', respondsTo: '',
  }];
  const outline = normalizeStoryOutline(outlineDocument([sequence]), 9, ['A']);
  const prompt = buildStoryDialogueManuscriptPrompt({ outline, language: 'en' });
  assert.match(prompt, /全片对白编剧/);
  assert.match(prompt, /不得把完整语义压成/);

  const locked = applyStoryDialogueManuscript(outline, { turns: [{
    beatIndex: 1,
    dialogueUnitId: 'dlg-1',
    turnIndex: 1,
    speaker: 'A',
    function: 'decision',
    contentGoal: 'A chooses to share control of the tide instead of carrying it alone',
    respondsTo: '',
    exactLine: 'I will open the western gate and let the others carry the tide with me.',
    meaningEvidence: 'let the others carry the tide with me',
    subtext: 'A releases the identity built around being indispensable.',
    listenerResult: 'The crew realizes the order is also an invitation to share responsibility.',
  }] }, ['A']);
  const turn = locked.sequences[0].beatMap[0].dialogueTurns[0];
  assert.equal(turn.exactLine, 'I will open the western gate and let the others carry the tide with me.');
  assert.equal(turn.meaningEvidence, 'let the others carry the tide with me');

  assert.throws(() => applyStoryDialogueManuscript(outline, { turns: [{
    beatIndex: 1,
    dialogueUnitId: 'dlg-1',
    turnIndex: 1,
    speaker: 'A',
    function: 'decision',
    contentGoal: 'A chooses to share control of the tide instead of carrying it alone',
    respondsTo: '',
    exactLine: 'I choose us.',
    meaningEvidence: 'I choose us',
    subtext: 'A changes.',
    listenerResult: 'The crew reacts.',
  }] }, ['A']), /过短/);
});

test('provider safety refusals receive a content-safe structured retry instead of a blind repeat', () => {
  const correction = structuredRetryCorrection(new Error("I'm sorry, but I can't assist with that request."));
  assert.match(correction, /SAFE-FICTION CORRECTION RETRY/);
  assert.match(correction, /non-graphic PG/);
  assert.match(correction, /requiredDialogueLines/);
  assert.doesNotMatch(structuredRetryCorrection(new Error('returned 2 items, expected 18')), /SAFE-FICTION/);
});

test('APIMart transport diagnostics never expose authorization headers or API keys', () => {
  const summary = apimartErrorSummary({
    code: 'ECONNRESET',
    message: 'socket hang up with sk-secretcredential123456',
    config: { headers: { Authorization: 'Bearer sk-secretcredential123456' }, data: 'full private prompt' },
  });
  assert.deepEqual(summary, {
    code: 'ECONNRESET',
    status: undefined,
    message: 'socket hang up with sk-[REDACTED]',
  });
  assert.doesNotMatch(JSON.stringify(summary), /secretcredential|Authorization|private prompt/);
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

test('director validation lets project language govern dialogue only and still rejects copied speech', () => {
  const beat = {
    index: 1,
    speech: [{ character: '人鱼公主', exactLine: 'Today, let it come on its own.' }],
  };
  assert.doesNotThrow(() => validateDirectorShots([
    { description: '[Medium shot] 人鱼公主 lowers her hand and turns toward the sea.', prompt: 'image prompt' },
  ], [beat], 'array(1)', 'en', ['人鱼公主']));
  assert.doesNotThrow(() => validateDirectorShots([
    { description: '[中景] 人鱼公主 lowers her hand.', prompt: 'image prompt' },
  ], [beat], 'array(1)', 'en', ['人鱼公主']));
  assert.doesNotThrow(() => validateDirectorShots([
    { description: '[中景] 人鱼公主 alarm 后转身。', prompt: 'image prompt' },
  ], [beat], 'array(1)', 'zh', ['人鱼公主']));
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
