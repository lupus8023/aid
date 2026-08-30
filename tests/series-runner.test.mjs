import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSeriesClaim } from '../lib/series/runner.ts';
import { createSeries, parseOutline, parseEpisodes, parseScript } from '../lib/series/domain.ts';
import { storyStorageKeys } from '../lib/series/storageScope.ts';
import { outlineFixture, episodeFixtures, shotFixture } from './fixtures/series.mjs';

test('production runner reuses locked shared assets, saves checkpoints and uploads the episode without touching ordinary Story', async () => {
  const project = createSeries({ name: '运行器测试', brief: '虚构测试', episodeCount: 3 });
  Object.assign(project, parseOutline(outlineFixture(), project));
  project.episodes = parseEpisodes(episodeFixtures(), project, 1, 3);
  project.characters.forEach((c, i) => { c.locked = true; c.voiceId = `fixed-${i}`; c.voiceSource = 'auto'; c.bibleUrl = `https://assets.test/${i}.png`; c.voiceReferenceUrl = `https://assets.test/voice-${i}.mp3`; });
  project.locations[0].imageUrl = 'https://assets.test/location.png';
  const settings = { apiKey: 'fixture-key', fishAudioKey: 'fixture-fish', imageModel: 'fixture-image', comfyui: { useLocalCompanion: true } };
  const saved = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  const storage = new Map([['aid:current-project:v2', 'ordinary-story'], ['appSettings', 'ordinary-settings'], ['aid:auto-production', 'ordinary-auto']]);
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const events = new EventTarget(); events.location = { origin: 'http://localhost:3027' }; globalThis.window = events;
  let uploaded = false, removed = false, checkpoints = 0, lastRevision = project.revision;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(url);
    if (url === '/api/companion/status') return Response.json({ ok: false });
    if (url === '/api/series/generate') {
      const body = JSON.parse(init.body); assert.equal(body.stage, 'script');
      assert.equal(body.project.characters[0].voiceId, 'fixed-0');
      return Response.json({ script: parseScript(shotFixture(), project, project.episodes[0]) });
    }
    if (url === '/api/companion/series') {
      const body = JSON.parse(init.body); assert.equal(body.action, 'checkpoint');
      assert.equal(body.project.revision, lastRevision); checkpoints++;
      return Response.json({ revision: ++lastRevision });
    }
    if (url.startsWith('/api/companion/series/delivery')) { assert.ok(checkpoints >= 4); assert.ok(init.body instanceof Blob); assert.equal(init.headers['X-AID-Lease'], 'lease-fixture'); uploaded = true; return Response.json({ ok: true }); }
    throw new Error(`Unexpected request: ${url}`);
  };
  globalThis.document = {
    createElement: () => ({ style: {}, contentWindow: {}, remove: () => { removed = true; } }),
    body: { appendChild: frame => {
      const params = new URL(frame.src, events.location.origin).searchParams;
      const keys = storyStorageKeys(params.get('seriesProject'));
      const production = JSON.parse(storage.get(keys.current));
      assert.ok(production.characters.every(c => c.voiceLocked && c.voiceSource === 'auto'));
      assert.equal(JSON.parse(storage.get(keys.settings)).comfyui.useLocalCompanion, false);
      assert.equal(JSON.parse(storage.get(keys.contract)).shotCount, 18);
      const send = data => { const event = new Event('message'); Object.assign(event, { origin: events.location.origin, source: frame.contentWindow, data: { type: 'aid-story-batch', runId: params.get('batchRunId'), ...data } }); events.dispatchEvent(event); };
      queueMicrotask(() => {
        send({ event: 'checkpoint', project: production });
        send({ event: 'completed', project: production, blob: new Blob(['fixture-mp4']) });
      });
    } },
  };
  try {
    await executeSeriesClaim({ job: { id: 'job-fixture', episodeId: 'ep-1', kind: 'produce', attempts: 1, lease: 'lease-fixture' }, project, settings }, new AbortController().signal, () => {});
    assert.ok(uploaded); assert.ok(removed);
    assert.equal(storage.get('aid:current-project:v2'), 'ordinary-story');
    assert.equal(storage.get('appSettings'), 'ordinary-settings');
    assert.equal(storage.get('aid:auto-production'), 'ordinary-auto');
    assert.equal(storage.size, 3);
    assert.ok(!requests.some(url => /voices|costume|voice-reference/.test(url)), 'locked shared assets are not generated again');
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
