import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSeries, parseOutline, parseEpisodes, parseScript, invalidateFrom, episodeContext, buildEpisodeProject, rescanSeriesObjectUsage, seriesShotObjectIds } from '../lib/series/domain.ts';
import { seriesPrompt } from '../lib/series/prompts.ts';
import { storyStorageKeys } from '../lib/series/storageScope.ts';
import { buildApprovedSeriesPlan, reconcileSeriesProductionContract, validateSeriesProduction } from '../lib/series/productionContract.ts';
import { auditStoryDelivery } from '../lib/storyDeliveryAudit.ts';
import { castStoryVoices } from '../lib/voiceCasting.ts';
import { rankFishVoiceModels } from '../lib/fishVoiceDiscovery.ts';
import { withSeriesDb, publicSnapshot, sealSettings, openSettings, requireLease, deliveryPath } from '../lib/series/store.ts';
import { outlineFixture, episodeFixtures, shotFixture } from './fixtures/series.mjs';
import { moveSeriesToTrash, restoreSeriesFromTrash } from '../lib/series/trash.ts';

function fixture() {
  const p = createSeries({ name: '回声档案', brief: '修复照片获得线索但失去记忆', episodeCount: 3 });
  Object.assign(p, parseOutline(outlineFixture(), p));
  p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  p.episodes[0].script = parseScript(shotFixture(), p, p.episodes[0]);
  return p;
}

test('square series keeps its chosen ratio when handed off to episode production', () => {
  const p = createSeries({ name: 'Square story', brief: 'A square-framed story', episodeCount: 3, aspectRatio: '1:1' });
  Object.assign(p, parseOutline(outlineFixture(), p));
  p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  p.episodes[0].script = parseScript(shotFixture(), p, p.episodes[0]);
  p.characters = p.characters.map(c => ({ ...c, locked: true, voiceId: 'fixture-voice' }));
  assert.equal(p.aspectRatio, '1:1');
  assert.equal(buildEpisodeProject(p, p.episodes[0]).aspectRatio, '1:1');
});

test('outline does not skip visual design for a deceased king in flashbacks or portraits', () => {
  const p = createSeries({ name: 'The Pearl Throne', brief: 'The late king appears in portraits.', episodeCount: 3 });
  const raw = outlineFixture();
  Object.assign(raw.characters[0], { name: 'King Corallus', appearance: 'voice_only', role: 'Recently deceased ruler; appears only in flashback, portrait, and recorded ceremonial material', description: 'Regal elderly mer-king with white beard, ceremonial armor and a heavy crown.' });
  assert.equal(parseOutline(raw, p).characters[0].appearance, 'on_screen');
  raw.characters[0].description = '全程出镜的老人，白胡须、金色王冠，照片和闪回保持一致。';
  assert.equal(parseOutline(raw, p).characters[0].appearance, 'on_screen');
  raw.characters[0].description = 'Disembodied ripple-like voice. No body is visible.';
  assert.equal(parseOutline(raw, p).characters[0].appearance, 'voice_only');
  raw.characters[0].description = '全程不出镜，无实体形象的旁白。';
  assert.equal(parseOutline(raw, p).characters[0].appearance, 'voice_only');
});

test('screenwriter receives the appearance classification for every episode character', () => {
  const p = fixture();
  p.characters[1].appearance = 'voice_only';
  const context = episodeContext(p, p.episodes[0]);
  assert.deepEqual(context.characters.map(c => c.appearance), ['on_screen', 'voice_only']);
});

test('a series fixed prop is identified in every matching shot and handed to Story with its exact reference', () => {
  const p = fixture();
  p.objects = [{ id: 'o1', name: '蓝瓷药瓶', aliases: ['御赐药瓶'], description: '矮圆瓶身、银泵、正面窄白签与右下缺口。', imageUrl: 'https://res.cloudinary.com/test/blue-bottle.png' }];
  const raw = shotFixture();
  raw.shots[0].visual += ' 桌上放着御赐药瓶。';
  const script = parseScript(raw, p, p.episodes[0]);
  assert.deepEqual(script[0].objectIds, ['o1']);
  assert.deepEqual(seriesShotObjectIds(p, script[0]), ['o1']);
  p.episodes[0].script = script;
  p.characters = p.characters.map(character => ({ ...character, locked: true, voiceId: 'fixture-voice' }));
  const production = buildEpisodeProject(p, p.episodes[0]);
  assert.equal(production.objects[0].imageUrl, p.objects[0].imageUrl);
  assert.match(production.storyContent, /固定道具：蓝瓷药瓶/);
  const prompt = seriesPrompt('script', p, p.episodes[0].id);
  assert.match(prompt, /objectIds/);
  assert.match(prompt, /蓝瓷药瓶/);
  assert.match(prompt, /不得另起别名或重新设计/);
});

test('uploading one fixed prop rescans an existing screenplay and attaches it only to matching shots', () => {
  const p = fixture(), raw = shotFixture();
  raw.shots[0].visual += ' 桌上放着御赐药瓶。';
  p.episodes[0].script = parseScript(raw, p, p.episodes[0]);
  assert.ok(p.episodes[0].script.every(shot => shot.objectIds.length === 0));
  p.objects = [{ id: 'o1', name: '蓝瓷药瓶', aliases: ['御赐药瓶'], description: '矮圆瓶身、银泵、正面窄白签与右下缺口。', imageUrl: 'https://res.cloudinary.com/test/blue-bottle.png' }];
  p.episodes = rescanSeriesObjectUsage(p);
  assert.deepEqual(p.episodes[0].script[0].objectIds, ['o1']);
  assert.ok(p.episodes[0].script.slice(1).every(shot => shot.objectIds.length === 0));
  p.objects = [];
  p.episodes = rescanSeriesObjectUsage(p);
  assert.ok(p.episodes[0].script.every(shot => shot.objectIds.length === 0));
});

test('approved series dialogue goes straight to direction, retaining A-B-A exchanges, silence and sound', () => {
  const p = fixture(), cast = p.characters.map(c => ({ ...c, voiceId: `voice-${c.id}` }));
  const names = new Map(cast.map(c => [c.id, c.name]));
  const contract = { shotCount: 18, story: { ...p.episodes[0], theme: p.bible.theme, logline: p.episodes[0].synopsis }, voices: Object.fromEntries(cast.map(c => [c.name, c.voiceId])), shots: p.episodes[0].script.map(s => ({
    number: s.number, seconds: s.seconds, action: s.action, visual: s.visual, purpose: s.purpose, locationId: s.locationId, sceneStyle: 'Reef hall', sound: s.sound,
    characters: [names.get('c1'), names.get('c2')], dialogue: s.dialogue.map(d => ({ ...d, character: names.get(d.characterId) })),
  })) };
  contract.shots[3].dialogue = [{ character: names.get('c1'), text: 'Luna leads.', emotion: 'official' }, { character: names.get('c2'), text: 'Absurd.', emotion: 'restrained' }, { character: names.get('c1'), text: 'They trust refusal.', emotion: 'careful' }];
  contract.dialogue = contract.shots.flatMap(s => s.dialogue.map(({ character, text }) => ({ character, text })));
  const original = structuredClone(contract);
  const plan = buildApprovedSeriesPlan(contract, 'Approved screenplay', cast), beats = plan.sequences.flatMap(s => s.beats);
  assert.equal(beats.length, 18); assert.equal(plan.estimatedDurationSeconds, 120);
  assert.deepEqual(beats[3].speech.map(s => [s.character, s.exactLine]), contract.shots[3].dialogue.map(s => [s.character, s.text]));
  assert.equal(beats[0].speech.length, 0);
  assert.deepEqual(beats[3].audioPlan.environment, [contract.shots[3].sound]);
  assert.deepEqual(contract, original); validateSeriesProduction(contract, beats);
  const boards = beats.map(beat => ({ ...beat, id: `scene-${beat.index}`, sceneNumber: beat.index }));
  assert.deepEqual(auditStoryDelivery(plan, boards).errors, [], 'episode contract is audited without inventing a standalone seven-act structure');
  const brokenPlan = structuredClone(plan); brokenPlan.seriesEpisode.goal = '';
  assert.match(auditStoryDelivery(brokenPlan, boards).errors.join(' '), /分集缺少/);
  const ordinaryPlan = { ...plan, seriesEpisode: undefined };
  assert.match(auditStoryDelivery(ordinaryPlan, boards).errors.join(' '), /七个叙事里程碑/);
  const invalid = structuredClone(contract); invalid.shots[0].number = 2;
  assert.throws(() => buildApprovedSeriesPlan(invalid, '', cast), /顺序/);
  const recast = structuredClone(cast); recast[0].voiceId = 'wrong';
  assert.throws(() => buildApprovedSeriesPlan(contract, '', recast), /音色/);
});

test('saved series contracts automatically follow the current registered voice and restore an omitted speaking cast member', () => {
  const contract = {
    shotCount: 18, voices: { ' 知夏 ': 'old-voice' }, dialogue: [{ character: '知夏', text: '原句。' }],
    shots: [{ number: 1, seconds: 6, characters: [], action: '动作', visual: '画面', purpose: '目的', dialogue: [{ character: ' 知夏 ', text: '原句。', emotion: '平静' }] }],
  };
  const repaired = reconcileSeriesProductionContract(contract, [{ name: '知夏', voiceId: 'current-voice' }]);
  assert.deepEqual(repaired.voices, { 知夏: 'current-voice' });
  assert.deepEqual(repaired.shots[0].characters, ['知夏']);
  assert.equal(repaired.shots[0].dialogue[0].character, '知夏');
  assert.equal(repaired.shots[0].dialogue[0].text, '原句。');
  assert.equal(contract.voices[' 知夏 '], 'old-voice');
});

test('approved series accepts four short alternating turns that reuse two H3 voices', () => {
  const p = fixture();
  p.characters.forEach((character, index) => { character.voiceId = `voice-${index}`; character.voiceLocked = true; });
  const cast = p.characters;
  const names = new Map(cast.map(character => [character.id, character.name]));
  const contract = {
    shotCount: 18,
    story: { title: '短对答', theme: p.bible.theme, logline: '测试', opening: '开场', goal: '目标', conflict: '冲突', choice: '选择', resolution: '结果', hook: '钩子' },
    voices: Object.fromEntries(cast.map(character => [character.name, character.voiceId])),
    shots: p.episodes[0].script.map(shot => ({ number: shot.number, seconds: shot.seconds, action: shot.action, visual: shot.visual, purpose: shot.purpose, locationId: shot.locationId, characters: shot.characterIds.map(id => names.get(id)), dialogue: [] })),
    dialogue: [],
  };
  contract.shots[11].characters = [names.get('c1'), names.get('c2')];
  contract.shots[11].dialogue = [
    { character: names.get('c1'), text: '陛下驾到——！', emotion: '高声' },
    { character: names.get('c2'), text: '还有多久？', emotion: '警觉' },
    { character: names.get('c1'), text: '半炷香。', emotion: '紧张' },
    { character: names.get('c2'), text: '来不及了。', emotion: '决断' },
  ];
  contract.dialogue = contract.shots.flatMap(shot => shot.dialogue.map(({ character, text }) => ({ character, text })));
  assert.doesNotThrow(() => buildApprovedSeriesPlan(contract, 'approved', cast));
});

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

test('deleting a running series rejects before changing any saved content or task', () => {
  const p = fixture(), jobs = [{ seriesId: p.id, status: 'running', lease: 'active' }];
  const before = JSON.stringify({ p, jobs });
  assert.throws(() => moveSeriesToTrash(p, jobs, '2026-08-30T00:00:00Z'), /暂停制作队列/);
  assert.equal(JSON.stringify({ p, jobs }), before);
});

test('trash hides a series and its tasks, preserves media and failed work, and restores without paid execution', () => {
  const p = fixture(), other = fixture();
  p.episodes[0].deliveries = [{ id: 'paid-film', fileName: 'keep.mp4', bytes: 12345, episodeVersion: 1 }];
  const contentBefore = structuredClone({ bible: p.bible, characters: p.characters, episodes: p.episodes });
  const jobs = [
    { id: 'queued', seriesId: p.id, status: 'queued', sealedSettings: 'encrypted-key', attempts: 0 },
    { id: 'failed', seriesId: p.id, status: 'failed', error: 'p4 missing', attempts: 1 },
    { id: 'completed', seriesId: p.id, status: 'completed' },
    { id: 'other', seriesId: other.id, status: 'queued' },
  ];
  const unaffected = structuredClone(jobs.slice(1));
  moveSeriesToTrash(p, jobs, '2026-08-30T00:00:00Z');
  assert.equal(p.paused, true);
  assert.equal(jobs[0].status, 'paused');
  assert.equal(jobs[0].sealedSettings, 'encrypted-key');
  assert.deepEqual(jobs.slice(1), unaffected);
  const snapshot = publicSnapshot({ projects: [p, other], jobs, workers: {} });
  assert.deepEqual(snapshot.projects.map(p => p.id), [other.id]);
  assert.deepEqual(snapshot.jobs.map(j => j.id), ['other']);
  assert.equal(snapshot.trashedProjects[0].deliveryCount, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /encrypted-key|sealedSettings|paid-film/);
  assert.throws(() => requireLease({ projects: [p], jobs: [{ id: 'late', seriesId: p.id, status: 'running', lease: 'old' }] }, 'late', 'old'), /回收站/);
  restoreSeriesFromTrash(p);
  assert.equal(p.deletedAt, undefined);
  assert.equal(p.paused, true);
  assert.equal(jobs[0].status, 'paused');
  assert.deepEqual({ bible: p.bible, characters: p.characters, episodes: p.episodes }, contentBefore);
  assert.equal(publicSnapshot({ projects: [p, other], jobs, workers: {} }).trashedProjects.length, 0);
});
