import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeStoryIdentities, storyIdentityContract } from '../lib/pipeline/storyIdentity.ts';
import { expandStoryCharacters, parseSourceDialogueByShot, applySourceDialogueAuthority } from '../lib/pipeline/storyWriter.ts';
import { sourceShotBlocks } from '../lib/pipeline/sourceScreenplay.ts';
import { buildSourceShotAdaptationMap, buildStorySpinePrompt } from '../lib/pipeline/storyWriterPrompt.ts';
import { characterFromGeneratedSeries } from '../lib/characterLibrary.ts';

const cast = [
  { name: '沈贵妃', aliases: ['贵妃', '娘娘', 'S2'], description: 'red robe', voiceId: 'voice-consort', voiceLocked: true },
  { name: '裴行简', aliases: ['裴大人', 'S1'], description: 'official' },
];
const source = `镜1 时长：3秒
景别：中景带前景 动作：贵妃抬手一甩，面膜拍在地上；裴大人脸色惨白。 运镜：从手部跟拍向下，再推到惨白的脸。 氛围：肃杀。
台词：
贵妃：“裴大人，你来进贡？”
裴大人：“沈贵妃，这是敷脸的！”
镜2 时长：4秒
景别：近景 动作：贵妃夹起面膜，皱眉。 运镜：推近手部。
台词：沈贵妃：“这么黑？”
裴大人：“敷之前也能见。”`;

test('registered names survive library storage and become one identity before screenplay expansion', () => {
  const saved = characterFromGeneratedSeries('series', { id: 'c2', name: '帝妃', aliases: ['贵妃', '娘娘'], casting: { name: '沈贵妃' }, description: 'red robe', bibleUrl: 'card.png' });
  assert.deepEqual(saved.aliases, ['贵妃', '娘娘', '沈贵妃']);
  const expanded = expandStoryCharacters(source, cast);
  assert.deepEqual(expanded.characters.map(c => c.name), ['沈贵妃', '裴行简']);
  assert.equal(expanded.characters[0].voiceId, 'voice-consort');
  assert.equal(expanded.characters[0].voiceLocked, true);
  assert.match(expanded.canonicalSynopsis, /“裴大人，你来进贡？”/);
  assert.match(expanded.canonicalSynopsis, /贵妃抬手一甩/); // authored action is not rewritten
  assert.deepEqual(parseSourceDialogueByShot(expanded.canonicalSynopsis, cast.map(c => c.name)).get(1), [
    { character: '沈贵妃', text: '裴大人，你来进贡？' },
    { character: '裴行简', text: '沈贵妃，这是敷脸的！' },
  ]);
});

test('normalization merges registered character entries and H3 speaker IDs, never exact words or action', () => {
  const raw = { protagonist: '贵妃', characters: [{ name: '贵妃' }, { name: '沈贵妃' }, { name: '裴大人' }], sequences: [{ beats: [{
    characters: ['贵妃', '沈贵妃', '裴大人'], action: '贵妃转身，裴大人停住。',
    performance: [{ character: '贵妃', gesture: '抬手一甩' }],
    dialogueTurns: [{ speaker: 'S2', exactLine: '裴大人！' }],
    speech: [{ character: '贵妃', speakerId: 'S9', exactLine: '沈贵妃也是贵妃。' }, { character: '沈贵妃', speakerId: 'S8', exactLine: '别改我的话。' }],
  }] }] };
  const normalized = canonicalizeStoryIdentities(raw, cast);
  assert.deepEqual(normalized.characters.map(c => c.name), ['沈贵妃', '裴行简']);
  const beat = normalized.sequences[0].beats[0];
  assert.deepEqual(beat.characters, ['沈贵妃', '裴行简']);
  assert.equal(beat.performance[0].character, '沈贵妃');
  assert.equal(beat.dialogueTurns[0].speaker, '沈贵妃');
  assert.deepEqual(beat.speech.map(line => line.speakerId), ['S1', 'S1']);
  assert.deepEqual(beat.speech.map(line => line.exactLine), raw.sequences[0].beats[0].speech.map(line => line.exactLine));
  assert.equal(beat.action, raw.sequences[0].beats[0].action);
  assert.equal(raw.characters.length, 3);
});

test('ambiguous titles never borrow an actor, and matching the sole uploaded card does not absorb supporting roles', () => {
  const ambiguous = [{ name: '沈贵妃', aliases: ['贵妃'] }, { name: '萧贵妃', aliases: ['贵妃'] }];
  assert.throws(() => expandStoryCharacters(source, ambiguous), /对应多个已登记角色/);
  const resolved = canonicalizeStoryIdentities({ speech: [{ character: '贵妃', exactLine: '不。' }] }, ambiguous);
  assert.equal(resolved.speech[0].character, '贵妃');
  const expanded = expandStoryCharacters('SHOT 1 | dialogue: A: “Hi.” B: “Hello.”', [{ name: 'A', description: 'card' }]);
  assert.deepEqual(expanded.characters.map(c => c.name), ['A', 'B']);
});

test('multiline shots preserve original action and camera context; repeated H3 phases remain a single shot', () => {
  assert.equal(sourceShotBlocks(source).length, 2);
  const expanded = expandStoryCharacters(source, cast);
  const beats = [1, 2].map(index => ({ index, actionGoal: 'model summary', dialogueTurns: [] }));
  applySourceDialogueAuthority({ sequences: [{ beatMap: beats }] }, expanded.canonicalSynopsis, cast.map(c => c.name));
  assert.equal(beats[0].actionGoal, '贵妃抬手一甩，面膜拍在地上；裴大人脸色惨白。');
  const groups = buildSourceShotAdaptationMap(source, 1);
  assert.match(groups[0].lockedSourceShots[0], /从手部跟拍向下/);
  assert.match(groups[0].lockedSourceShots[1], /敷之前也能见/);
  const h3 = '[Shot 1 | 00:00–00:04]\nAction: S2 raises a hand.\nDialogue: S2: “停。”\n[Shot 1 | 00:04–00:08]\nS2 lowers it.\nDialogue: S2: “坐。”';
  assert.equal(sourceShotBlocks(h3).length, 1);
  const expandedH3 = expandStoryCharacters(h3, cast);
  assert.deepEqual(parseSourceDialogueByShot(expandedH3.canonicalSynopsis, cast.map(c => c.name)).get(1)?.map(line => line.text), ['停。', '坐。']);
});

test('writer prompt gives registered aliases one H3 identity and keeps authored staging authoritative', () => {
  const prompt = buildStorySpinePrompt({ synopsis: source, characters: cast, objects: [], language: 'zh', targetShotCount: 4 });
  assert.ok(prompt.includes(storyIdentityContract(cast)));
  assert.match(prompt, /同一个人，不得新增角色或分配第二个 S ID/);
  assert.match(prompt, /不把具体动作概括成剧情摘要/);
});
