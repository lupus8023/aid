import assert from 'node:assert/strict';
import test from 'node:test';
import { seriesCastLibrary, selectLibraryImage, applyLibraryActor, castSeriesRole } from '../lib/series/casting.ts';
import { createSeries, parseOutline, parseEpisodes } from '../lib/series/domain.ts';
import { executeSeriesClaim } from '../lib/series/runner.ts';
import { seriesStageBlocker, seriesAssetsReady } from '../lib/series/readiness.ts';
import { outlineFixture, episodeFixtures } from './fixtures/series.mjs';

const actor = { id: 'library-actor', name: '库内演员', description: '黑色短发，灰色长外套', imageUrl: 'https://assets.test/portrait.png', bibleUrl: 'https://assets.test/bible.png', voiceId: 'saved-voice', voiceProfile: '低沉温和' };
function fixture() {
  const project = createSeries({ name: '选角验证', brief: '测试角色库复用', episodeCount: 3 });
  Object.assign(project, parseOutline(outlineFixture(), project));
  project.episodes = parseEpisodes(episodeFixtures(), project, 1, 3);
  return project;
}

test('series library retains the complete design card and saved voice without rewriting browser history', () => {
  const history = [{ ...actor, imageUrl: 'data:image/jpeg;base64,bGVnYWN5', bibleUrl: undefined }];
  const designs = [{ id: actor.id, name: actor.name, description: '黑发', costumeDesc: '灰色外套', role: '其他故事的反派', personality: '其他故事的性格', conceptUrl: actor.imageUrl, bibleUrl: actor.bibleUrl }];
  const before = JSON.stringify({ history, designs });
  const library = seriesCastLibrary(history, designs);
  assert.equal(library.length, 1);
  assert.equal(library[0].bibleUrl, actor.bibleUrl);
  assert.equal(library[0].voiceId, actor.voiceId);
  assert.equal(library[0].description, '黑发；灰色外套');
  assert.doesNotMatch(library[0].description, /反派|性格/);
  assert.equal(JSON.stringify({ history, designs }), before);
  assert.equal(seriesCastLibrary(history, [])[0].imageUrl, history[0].imageUrl);
  assert.deepEqual(seriesCastLibrary([null, {}, { name: 'no image' }], []), []);
});

test('casting replaces appearance but retains the dramatic identity, storyline and archived deliveries', () => {
  const project = fixture(), original = structuredClone(project.characters[0]);
  project.episodes[0].production = { id: 'old-production' };
  project.episodes[0].script = [{ visual: '原有镜头' }];
  project.episodes[0].deliveries = [{ id: 'old-film', episodeVersion: 1 }];
  project.episodes[2].characterIds = [];
  const unrelated = structuredClone(project.episodes[2]);
  assert.equal(castSeriesRole(project, original.id, { ...actor, name: actor.name, role: '覆盖身份', secret: '覆盖秘密' }), true);
  const cast = project.characters[0];
  for (const key of ['id', 'name', 'role', 'want', 'secret', 'arc', 'aliases', 'importance', 'speaking']) assert.deepEqual(cast[key], original[key]);
  assert.equal(cast.bibleUrl, actor.bibleUrl);
  assert.equal(cast.voiceId, actor.voiceId);
  assert.equal(cast.voiceLocked, true);
  assert.equal(cast.locked, false, 'a missing voice sample still needs preparation');
  assert.equal(project.episodes[0].production, undefined);
  assert.equal(project.episodes[0].version, 2);
  assert.equal(project.episodes[0].deliveries[0].id, 'old-film');
  assert.equal(project.episodes[0].script[0].visual, '原有镜头');
  assert.deepEqual(project.episodes[2], unrelated);
  assert.equal(castSeriesRole(project, original.id, actor), false);
  assert.equal(project.episodes[0].version, 2);
});

test('actors without a stored voice do not inherit a previous actor voice, but preserve a deliberate per-role override', () => {
  const role = fixture().characters[0];
  const a = applyLibraryActor(role, actor);
  const noVoice = { ...actor, id: 'new-actor', name: '新演员', voiceId: undefined };
  const b = applyLibraryActor(a, noVoice);
  assert.equal(b.voiceId, undefined);
  assert.equal(b.voiceReferenceUrl, undefined);
  const manual = applyLibraryActor({ ...a, voiceId: 'explicit-role-voice', voiceSource: 'user', voiceReferenceUrl: 'https://assets.test/manual.mp3' }, noVoice);
  assert.equal(manual.voiceId, 'explicit-role-voice');
  assert.equal(manual.voiceReferenceUrl, 'https://assets.test/manual.mp3');
  b.voiceId = 'later-auto-voice'; b.voiceReferenceUrl = 'https://assets.test/auto.mp3'; b.locked = true;
  assert.equal(applyLibraryActor(b, noVoice), b, 'reselecting unchanged actor retains later automatic preparation');
});

test('casting validates persistent URLs before changing a project and does not trust arbitrary payload fields', () => {
  const project = fixture(), before = JSON.stringify(project);
  assert.throws(() => castSeriesRole(project, project.characters[0].id, { ...actor, bibleUrl: 'javascript:alert(1)' }), /HTTPS/);
  assert.equal(JSON.stringify(project), before);
  assert.throws(() => applyLibraryActor(project.characters[0], { ...actor, imageUrl: 'data:image/png;base64,eA==' }), /HTTPS/);
  const cast = applyLibraryActor(project.characters[0], { ...actor, voiceReferenceUrl: 'https://assets.test/voice.mp3', locked: false, version: 999 });
  assert.equal(cast.version, 2);
  assert.equal(cast.locked, true);
});

test('preparation reuses selected library images and only synthesizes the missing voice reference', async () => {
  const project = fixture();
  castSeriesRole(project, project.characters[0].id, actor);
  project.characters[1].locked = true;
  project.characters[1].bibleUrl = 'https://assets.test/other.png';
  project.characters[1].voiceId = 'other-voice';
  project.characters[1].voiceReferenceUrl = 'https://assets.test/other.mp3';
  project.locations.forEach(location => { location.imageUrl = 'https://assets.test/location.png'; });
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url === '/api/companion/status') return Response.json({ ok: false });
    if (url === '/api/companion/series') return Response.json({ revision: JSON.parse(options.body).project.revision + 1 });
    if (url === '/api/generate-voice-reference') {
      const body = JSON.parse(options.body);
      assert.equal(body.voiceId, actor.voiceId); assert.equal(body.strictVoice, true);
      assert.equal(body.verifyLanguage, true, 'a manually selected voice is checked in the project language');
      return Response.json({ url: 'https://assets.test/sample.mp3', voiceId: actor.voiceId, duration: 4, languageCheck: { passed: true, matchScore: 1 } });
    }
    throw new Error(`Unexpected regeneration: ${url}`);
  };
  try {
    await executeSeriesClaim({ project, job: { id: 'prepare-library', kind: 'prepare', lease: 'fixture' }, settings: { apiKey: 'test', fishAudioKey: 'test' } }, new AbortController().signal, () => {});
    assert.equal(calls.filter(url => url === '/api/generate-voice-reference').length, 1);
    assert.equal(project.characters[0].locked, true);
    assert.equal(project.characters[0].bibleUrl, actor.bibleUrl);
    assert.ok(!calls.some(url => /costume|series\/voices/.test(url)));
  } finally { globalThis.fetch = previousFetch; }
});

test('same-name design merge retains the images shown by the original library and legacy thumbnails', () => {
  const legacy = 'data:image/png;base64,bGVnYWN5';
  const [entry] = seriesCastLibrary([{ id: 'history-id', name: actor.name, imageUrl: 'https://assets.test/history.png', imageBase64: legacy }],
    [{ ...actor, id: 'design-id', conceptUrl: 'https://assets.test/visible-concept.png' }]);
  assert.deepEqual(entry.imageCandidates, [actor.bibleUrl, 'https://assets.test/visible-concept.png', actor.imageUrl, 'https://assets.test/history.png', legacy]);
  for (const fallback of entry.imageCandidates.slice(1)) {
    const chosen = selectLibraryImage(entry, fallback);
    assert.equal(chosen.bibleUrl, undefined, 'failed card must not be saved over the visible fallback');
    assert.equal(chosen.imageUrl, fallback);
    assert.equal(chosen.imageCandidates, undefined, 'do not save entire library image data in production');
  }
  assert.equal(selectLibraryImage(entry, actor.bibleUrl).bibleUrl, actor.bibleUrl);
  assert.throws(() => selectLibraryImage(entry, 'https://unknown.test/new.png'));
});

test('preparation can finish with missing or outdated episodes, while script and production remain blocked', async () => {
  const previousFetch = globalThis.fetch;
  try {
    for (const outdated of [false, true]) {
      const project = fixture();
      if (outdated) project.episodes[0].needsReview = '分集待修订';
      else project.episodes = [];
      project.characters.forEach(c => {
        c.bibleUrl = 'https://assets.test/ready.png';
        c.voiceId = `voice-${c.id}`;
        c.voiceReferenceUrl = 'https://assets.test/ready.mp3';
        c.locked = false;
      });
      project.locations.forEach(l => { l.imageUrl = 'https://assets.test/scene.png'; });
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push(url);
        if (url === '/api/companion/status') return Response.json({ ok: false });
        if (url === '/api/companion/series') return Response.json({ revision: JSON.parse(options.body).project.revision + 1 });
        throw new Error(`Unexpected provider call: ${url}`);
      };
      assert.equal(seriesStageBlocker(project, 'prepare'), '');
      assert.equal(seriesAssetsReady(project), false);
      for (const kind of ['script', 'produce']) {
        assert.match(seriesStageBlocker(project, kind), /分集故事/);
        await assert.rejects(executeSeriesClaim({ project, job: { kind, episodeId: 'ep-1' }, settings: {} }, new AbortController().signal, () => {}), /分集故事/);
      }
      await executeSeriesClaim({ project, job: { id: 'independent-prepare', kind: 'prepare', lease: 'fixture' }, settings: {} }, new AbortController().signal, () => {});
      assert.equal(seriesAssetsReady(project), true);
      assert.equal(project.episodes.length, outdated ? 3 : 0);
      if (outdated) assert.equal(project.episodes[0].needsReview, '分集待修订');
      assert.ok(!calls.some(url => /generate|voices|costume/.test(url)));
      project.locations = [];
      assert.match(seriesStageBlocker(project, 'prepare'), /清单/);
    }
  } finally { globalThis.fetch = previousFetch; }
});

test('automatic prop references are prepared by the queue while user-specified props require uploads', () => {
  const project = fixture();
  project.objects = [{
    id: 'o1', name: '自动铜镜', aliases: [], description: '椭圆青铜镜，背面莲纹。', imageUrl: '', referenceMode: 'auto',
  }];
  assert.equal(seriesStageBlocker(project, 'prepare'), '');
  project.objects.push({
    id: 'object-user', name: '指定锦盒', aliases: [], description: '用户现有的品牌包装。', imageUrl: '', referenceMode: 'upload',
  });
  assert.match(seriesStageBlocker(project, 'prepare'), /用户指定道具.*指定锦盒/);
  project.objects[1].imageUrl = 'https://assets.test/user-box.png';
  assert.equal(seriesStageBlocker(project, 'prepare'), '');
});
