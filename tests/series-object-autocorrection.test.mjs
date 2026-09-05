import assert from 'node:assert/strict';
import test from 'node:test';
import { fixedObjectIdentityError, inferSupersededObjectIds } from '../lib/series/objectIdentity.ts';
import { episodeAssetReferences } from '../lib/series/episodeAssetReferences.ts';
import { fitScriptDialogueDurations } from '../lib/series/scriptRepair.ts';
import { applyFinalObjectReplacements, applyPartialObjectGroundingRepairs } from '../lib/series/scriptStructureRepair.ts';
import { generateSeriesStage } from '../lib/series/generation.ts';
import { createSeries, parseOutline, parseEpisodes } from '../lib/series/domain.ts';
import { outlineFixture, episodeFixtures, shotFixture } from './fixtures/series.mjs';

test('prop conflict identifies owner without silently merging package and contents', () => {
  const objects = [{ id: 'box', name: '锦盒', aliases: ['面膜', 'Box'] }];
  assert.match(fixedObjectIdentityError(objects, '面膜袋', ['面膜']), /“面膜”已被道具“锦盒”/);
  assert.match(fixedObjectIdentityError(objects, ' box ', []), /锦盒/);
  assert.equal(fixedObjectIdentityError(objects, '锦盒', ['面膜'], 'box'), undefined);
  assert.equal(fixedObjectIdentityError(objects, '金色面膜盒', ['金色外包装']), undefined);
  assert.match(fixedObjectIdentityError([], '面膜袋', ['面膜袋']), /当前道具中重复/);
});

test('specific uploaded packaging supersedes only the same generic container class', () => {
  const objects = [
    { id: 'box', name: '锦盒', aliases: ['面膜盒'] },
    { id: 'mask', name: '黑灰色纱布面膜', aliases: ['面膜'] },
  ];
  assert.deepEqual(inferSupersededObjectIds(objects, '金色面膜盒'), ['box']);
  assert.deepEqual(inferSupersededObjectIds(objects, '金色面膜袋'), []);
});

test('final specified prop rewrites every visual field and binding but never dialogue', () => {
  const project = { objects: [
    { id: 'old', name: '锦盒', aliases: ['面膜盒'] },
    { id: 'gold', name: '金色面膜盒', aliases: [], replacesObjectIds: ['old'] },
  ] };
  const source = { shots: [{ number: 1, objectIds: ['old'], visual: '锦盒在桌上', imagePrompt: '面膜盒 close-up', action: '她拿起锦盒', purpose: '展示锦盒', sound: '锦盒落桌', dialogue: [{ text: '把锦盒拿来。' }] }] };
  const result = applyFinalObjectReplacements(source, project);
  assert.deepEqual(result.raw.shots[0].objectIds, ['gold']);
  for (const field of ['visual', 'imagePrompt', 'action', 'purpose', 'sound']) assert.match(result.raw.shots[0][field], /金色面膜盒/);
  assert.equal(result.raw.shots[0].dialogue[0].text, '把锦盒拿来。');
  assert.equal(result.logs[0].kind, 'object_replaced');
});

test('missing episode ID lists recover from registered names without another model rewrite', () => {
  const project = createSeries({ name: '测试', brief: '测试', episodeCount: 3 });
  Object.assign(project, parseOutline(outlineFixture(), project));
  const raw = episodeFixtures();
  delete raw.episodes[0].characterIds;
  delete raw.episodes[0].locationIds;
  raw.episodes[0].synopsis += '林知夏与陈叔回到旧照相馆。';
  const result = parseEpisodes(raw, project, 1, 3);
  assert.deepEqual(result[0].characterIds, ['c1', 'c2']);
  assert.deepEqual(result[0].locationIds, ['l1']);
  assert.equal(result[0].synopsis, raw.episodes[0].synopsis);
});

test('episode reference recovery resolves only unique exact names, never unknown IDs or future actors', () => {
  const assets = [{ id: 'c1', name: '贵妃', aliases: ['娘娘'] }, { id: 'c2', name: '淑妃', aliases: ['娘娘'] }];
  assert.deepEqual(episodeAssetReferences({ characterIds: ['贵妃', 'c1'] }, 'characterIds', assets), ['c1']);
  assert.deepEqual(episodeAssetReferences({ characterIds: ['unknown'] }, 'characterIds', assets), ['unknown']);
  assert.deepEqual(episodeAssetReferences({ synopsis: '娘娘开口', nextOpening: '淑妃入殿' }, 'characterIds', assets), []);
});

test('short duration estimates extend locally without changing dialogue or enforcing two minutes', async () => {
  const { project, raw } = fixture();
  raw.shots.forEach(shot => {
    shot.objectIds = [];
    shot.dialogue = [{ characterId: 'c1', text: '这不是普通的物件，我要亲自看清楚它到底来自哪里，再决定接下来怎么办。', emotion: '克制' }];
  });
  const result = await generateSeriesStage('script', project, project.episodes[0].id, {
    read: async () => JSON.stringify(raw), chat: async () => assert.fail('no rewrite needed'),
  });
  assert.ok(result.script.reduce((sum, shot) => sum + shot.seconds, 0) > 150);
  for (const [index, shot] of result.script.entries()) {
    assert.deepEqual(shot.dialogue, raw.shots[index].dialogue);
    assert.equal(shot.action, raw.shots[index].action);
    assert.ok(shot.seconds <= 15);
  }
  assert.equal(fitScriptDialogueDurations({ shots: [{ number: 1, seconds: 7, dialogue: [{ text: '字'.repeat(300) }] }] }, 'zh').raw.shots[0].seconds, 15);
});

function fixture() {
  const project = createSeries({ name: '修稿测试', brief: '独立测试', episodeCount: 3 });
  Object.assign(project, parseOutline(outlineFixture(), project));
  project.episodes = parseEpisodes(episodeFixtures(), project, 1, 3);
  project.objects = [{ id: 'mask', name: '黑灰色纱布面膜', aliases: [], description: '柔软湿润的面膜布', referenceMode: 'upload', imageUrl: 'https://example.com/mask.png' }];
  const raw = shotFixture();
  for (const index of [1, 13]) {
    raw.shots[index].objectIds = ['mask'];
    raw.shots[index].action = '她将湿黑面膜轻轻揭下，停在半空。';
  }
  return { project, raw };
}

test('exact noun binding preserves all action, dialogue, timing and other shots', async () => {
  const { project, raw } = fixture();
  let draft = JSON.stringify(raw), calls = 0;
  await generateSeriesStage('script', project, project.episodes[0].id, {
    read: async () => draft, save: async value => { draft = value; },
    chat: async prompt => {
      calls++;
      assert.match(prompt, /mention=the EXACT short noun phrase/);
      return JSON.stringify({ repairs: [2, 14].map(shotNumber => ({ shotNumber, objectId: 'mask', decision: 'ground', field: 'action', mention: '湿黑面膜' })) });
    },
  });
  assert.equal(calls, 1);
  const expected = structuredClone(raw);
  for (const index of [1, 13]) expected.shots[index].action = '她将黑灰色纱布面膜轻轻揭下，停在半空。';
  assert.deepEqual(JSON.parse(draft), expected);
});

test('one bad patch no longer discards other repaired shots; next call targets only remainder', async () => {
  const { project, raw } = fixture();
  let draft = JSON.stringify(raw), calls = 0;
  const result = await generateSeriesStage('script', project, project.episodes[0].id, {
    read: async () => draft, save: async value => { draft = value; },
    chat: async prompt => {
      calls++;
      if (calls === 1) return JSON.stringify({ repairs: [
        { shotNumber: 2, objectId: 'mask', decision: 'ground', field: 'action', mention: '湿黑面膜' },
        { shotNumber: 14, objectId: 'mask', decision: 'ground', field: 'action', value: raw.shots[13].action },
      ] });
      assert.equal(JSON.parse(draft).shots[1].action, '她将黑灰色纱布面膜轻轻揭下，停在半空。');
      assert.doesNotMatch(prompt, /"shotNumber":2,/);
      return JSON.stringify({ repairs: [{ shotNumber: 14, objectId: 'mask', decision: 'ground', field: 'action', mention: '湿黑面膜' }] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.scriptAssetRepairs.length, 2);
});

test('invented mentions, duplicate targets and unauthorized paths never overwrite draft', () => {
  const raw = { shots: [{ number: 1, objectIds: ['mask'], action: '她拿起面膜。', visual: '中景' }] };
  const issues = [{ kind: 'ungrounded_object', index: 0, shotNumber: 1, objectId: 'mask', objectName: '黑灰色纱布面膜', aliases: [] }];
  const repair = { shotNumber: 1, objectId: 'mask', decision: 'ground', field: 'action', mention: '不存在' };
  assert.throws(() => applyPartialObjectGroundingRepairs(raw, { repairs: [repair] }, issues), /真实存在/);
  assert.throws(() => applyPartialObjectGroundingRepairs(raw, { repairs: [repair, repair] }, issues), /重复/);
  assert.throws(() => applyPartialObjectGroundingRepairs(raw, { repairs: [{ ...repair, shotNumber: 2 }] }, issues), /未授权/);
  assert.equal(raw.shots[0].action, '她拿起面膜。');
});
