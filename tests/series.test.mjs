import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSeries, parseOutline, parseEpisodes, parseScript, invalidateFrom, episodeContext, buildEpisodeProject } from '../lib/series/domain.ts';
import { storyStorageKeys } from '../lib/series/storageScope.ts';
import { validateSeriesProduction } from '../lib/series/productionContract.ts';
import { castStoryVoices } from '../lib/voiceCasting.ts';
import { rankFishVoiceModels } from '../lib/fishVoiceDiscovery.ts';
import { withSeriesDb, publicSnapshot, sealSettings, openSettings, requireLease, deliveryPath } from '../lib/series/store.ts';
import { outlineFixture, episodeFixtures, shotFixture } from './fixtures/series.mjs';

function fixture() {
  const p = createSeries({ name: '回声档案', brief: '修复照片获得线索但失去记忆', episodeCount: 3 });
  Object.assign(p, parseOutline(outlineFixture(), p));
  p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  p.episodes[0].script = parseScript(shotFixture(), p, p.episodes[0]);
  return p;
}

test('series screenplay enforces count, timing, canonical speakers and payoff promises', () => {
  const p = fixture();
  assert.equal(p.episodes[0].script.reduce((n, s) => n + s.seconds, 0), 120);
  const invalid = shotFixture(); invalid.shots[0].dialogue = [{ characterId: 'stranger', text: '台词', emotion: '' }];
  assert.throws(() => parseScript(invalid, p, p.episodes[0]), /未登记/);
  assert.throws(() => parseScript({ shots: invalid.shots.slice(1) }, p, p.episodes[0]), /18镜/);
  const longLine = shotFixture(); longLine.shots[0].dialogue = [{ characterId: 'c1', text: '很长的台词。'.repeat(30), emotion: '' }];
  assert.throws(() => parseScript(longLine, p, p.episodes[0]), /超时/);
  const missedPayoff = episodeFixtures(); missedPayoff.episodes[1].paysOff = [];
  assert.throws(() => parseEpisodes(missedPayoff, p, 1, 3), /遗漏应回收/);
  const gap = outlineFixture(); gap.bible.arcs[0].start = 2;
  assert.throws(() => parseOutline(gap, p), /连续覆盖/);
});

test('editing an early episode invalidates dependent drafts but preserves delivered versions', () => {
  const p = fixture();
  p.episodes[1].production = { id: 'paid-project' };
  p.episodes[1].deliveries = [{ id: 'delivered-v1', episodeVersion: 1 }];
  const changed = invalidateFrom(p, 2, '第二集修改');
  assert.equal(changed.episodes[0], p.episodes[0]);
  assert.equal(changed.episodes[1].production, undefined);
  assert.equal(changed.episodes[2].version, 2);
  assert.deepEqual(changed.episodes[1].deliveries, p.episodes[1].deliveries);
});

test('next-episode context includes established knowledge without sending old production payloads', () => {
  const p = fixture(); p.episodes[0].production = { storyboards: ['large-media-payload'] };
  const context = episodeContext(p, p.episodes[2]);
  assert.equal(context.knowledge.length, 2);
  assert.equal(context.recent.at(-1).number, 2);
  assert.doesNotMatch(JSON.stringify(context), /large-media-payload/);
});

test('automatically selected and locked voices survive later Story casting without becoming user selections', () => {
  const cast = castStoryVoices([{ name: '知夏', gender: 'female', ageGroup: 'young_adult', voiceId: 'series-licensed-voice', voiceSource: 'auto', voiceLocked: true }]);
  assert.equal(cast[0].voiceId, 'series-licensed-voice'); assert.equal(cast[0].voiceSource, 'auto');
  const p = fixture();
  assert.throws(() => buildEpisodeProject(p, p.episodes[0]), /尚未定稿/);
  p.characters.forEach((c, i) => { c.locked = true; c.voiceId = `voice-${i}`; c.voiceSource = 'auto'; c.bibleUrl = `https://example.test/${i}.png`; });
  const production = buildEpisodeProject(p, p.episodes[0]);
  assert.equal(production.targetShotCount, 18);
  assert.ok(production.characters.every(c => c.voiceLocked));
  assert.match(production.storyContent, /必须逐字保留/);
});

test('series keys never overwrite ordinary projects, settings or other episodes', () => {
  const normal = storyStorageKeys(''), a = storyStorageKeys('series-a-ep-1'), b = storyStorageKeys('series-a-ep-2');
  assert.equal(normal.current, 'aid:current-project:v2'); assert.equal(normal.auto, 'aid:auto-production');
  for (const key of ['current', 'legacy', 'auto', 'settings']) { assert.notEqual(a[key], b[key]); assert.notEqual(a[key], normal[key]); }
});

test('director cannot change approved episode dialogue or add a speaker before media generation', () => {
  const contract = { shotCount: 18, voices: { 知夏: 'licensed-a' }, dialogue: [{ character: '知夏', text: '这块表，我见过。' }] };
  const boards = Array.from({ length: 18 }, () => ({ speech: [] }));
  boards[4].speech = [{ character: '知夏', voiceId: 'licensed-a', exactLine: '这块表，我见过。' }];
  validateSeriesProduction(contract, boards);
  boards[4].speech[0].exactLine = '这块表我没见过。';
  assert.throws(() => validateSeriesProduction(contract, boards), /改写/);
  boards[4].speech[0] = { character: '路人', voiceId: 'new', exactLine: '我知道真相。' };
  assert.throws(() => validateSeriesProduction(contract, boards), /未定稿/);
});

test('Fish ranking recognizes female without matching male substring, supports trained models, and excludes retired voices', () => {
  const ranked = rankFishVoiceModels([
    { _id: 'man', title: 'English male adult', languages: ['en'], state: 'trained' },
    { _id: 'woman', title: 'English female young', languages: ['en'], state: 'trained' },
    { _id: 'retired', title: 'English female young', languages: ['en'], pvc_release_state: 'retiring' },
  ], { name: 'Lead', gender: 'female', ageGroup: 'young_adult', language: 'en' });
  assert.equal(ranked[0]._id, 'woman'); assert.ok(!ranked.some(m => m._id === 'retired'));
});

test('disk store serializes concurrent writes, encrypts credentials and rejects stale leases and traversal', async () => {
  const previous = process.env.AID_COMPANION_DATA_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aid-series-test-')); process.env.AID_COMPANION_DATA_DIR = dir;
  try {
    await Promise.all(Array.from({ length: 12 }, (_, i) => withSeriesDb(db => { db.projects.push(createSeries({ name: `剧${i}`, brief: '测试', episodeCount: 3 })); })));
    let sealed;
    await withSeriesDb(async db => { assert.equal(db.projects.length, 12); sealed = await sealSettings({ apiKey: 'test-private-value' }); db.jobs.push({ id: 'job-1', status: 'running', lease: 'lease-1', sealedSettings: sealed });
      assert.throws(() => requireLease(db, 'job-1', 'stale'), /租约已失效/);
      assert.equal(requireLease(db, 'job-1', 'lease-1').id, 'job-1');
      assert.doesNotMatch(JSON.stringify(publicSnapshot(db)), /lease-1|sealedSettings|test-private-value/);
    });
    assert.equal((await openSettings(sealed)).apiKey, 'test-private-value');
    assert.doesNotMatch(await readFile(path.join(dir, 'series/index.json'), 'utf8'), /test-private-value/);
    assert.equal((await stat(path.join(dir, 'series/credentials.key'))).mode & 0o777, 0o600);
    assert.throws(() => deliveryPath('../outside', 'id'), /无效/);
    await writeFile(path.join(dir, 'series/index.json'), 'not json');
    await assert.rejects(withSeriesDb(() => {}), /已保留原文件/);
    assert.equal(await readFile(path.join(dir, 'series/index.json'), 'utf8'), 'not json');
  } finally { if (previous === undefined) delete process.env.AID_COMPANION_DATA_DIR; else process.env.AID_COMPANION_DATA_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});
