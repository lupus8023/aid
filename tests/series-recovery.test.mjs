import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVoiceReferenceService } from '../lib/voiceReferenceGeneration.ts';
import { createMediaUploadTickets, uploadBufferToCloudinary } from '../lib/cloudinaryUpload.ts';
import { generateSeriesStage } from '../lib/series/generation.ts';
import { createSeries, parseOutline } from '../lib/series/domain.ts';
import { executeSeriesClaim } from '../lib/series/runner.ts';
import { findSeriesVoices } from '../lib/series/voices.ts';
import { outlineFixture, episodeFixtures } from './fixtures/series.mjs';

const input = { voiceId: 'chosen-voice', fishAudioKey: 'private-fixture-key', language: 'zh', strictVoice: true };
function fixture() {
  const p = createSeries({ name: '逐集恢复测试', brief: '独立测试', episodeCount: 3 });
  Object.assign(p, parseOutline(outlineFixture(), p));
  return p;
}

test('voice storage is checked before synthesis; failed upload is resumed across restart without a second purchase', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aid-voice-recovery-'));
  let generations = 0, uploads = 0, ready = false;
  const deps = {
    root, ready: async () => { if (!ready) throw new Error('offline'); },
    synthesize: async (_text, voiceId, key, options) => {
      generations++; assert.equal(key, input.fishAudioKey); assert.equal(options.strictVoice, true);
      return { buffer: Buffer.alloc(2048, 7), voiceId, requestedVoiceId: voiceId };
    },
    upload: async (buffer, options) => {
      uploads++; assert.equal(buffer.length, 2048); assert.match(options.public_id, /^voice-ref-timbre-v3-/);
      if (uploads === 1) throw new Error('upload offline');
      return { secure_url: `https://assets.test/${options.public_id}.mp3`, duration: 6 };
    },
  };
  try {
    const first = createVoiceReferenceService(deps);
    await assert.rejects(first(input), e => e.code === 'VOICE_STORAGE_FAILED' && /未提交/.test(e.message));
    assert.equal(generations, 0);
    ready = true;
    await assert.rejects(first(input), e => e.code === 'VOICE_STORAGE_FAILED' && /已保留/.test(e.message));
    assert.equal(generations, 1);
    const restarted = createVoiceReferenceService(deps);
    const [a, b] = await Promise.all([restarted(input), restarted(input)]);
    assert.deepEqual(a, b); assert.equal(a.voiceId, input.voiceId); assert.equal(generations, 1); assert.equal(uploads, 2);
    await createVoiceReferenceService(deps)(input);
    assert.equal(generations, 1); assert.equal(uploads, 2);
    for (const name of await readdir(root)) assert.ok(!(await readFile(path.join(root, name), 'utf8')).includes(input.fishAudioKey));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing p4 repairs the original draft with its full schedule; cached valid output makes no further LLM call', async () => {
  const p = fixture();
  p.bible.promises.push({ id: 'p4', question: '真实代价是什么', plantedIn: 1, payoffIn: 3, answer: '忘记父亲' });
  const bad = { episodes: [episodeFixtures().episodes[0]] };
  const good = structuredClone(bad);
  good.episodes[0].plants.push('p4');
  good.episodes[0].synopsis += '她突然认不出照片上的父亲，意识到继续调查可能失去最珍贵的记忆。';
  let saved, calls = 0;
  const chat = async prompt => {
    calls++;
    assert.match(prompt, /本集强制伏笔清单/); assert.match(prompt, /"id":"p4"/);
    if (calls === 1) return JSON.stringify(bad);
    assert.ok(prompt.includes(JSON.stringify(JSON.stringify(bad))));
    assert.match(prompt, /遗漏应埋设伏笔 p4/); assert.match(prompt, /不得只在数组里补ID/);
    return JSON.stringify(good);
  };
  const result = await generateSeriesStage('episodes', p, undefined, { chat, save: async raw => { saved = raw; } });
  assert.deepEqual(result.episodes[0].plants, ['p1', 'p2', 'p4']);
  assert.equal(result.episodes[0].title, bad.episodes[0].title);
  const repeated = await generateSeriesStage('episodes', p, undefined, { chat: async () => { throw new Error('duplicate purchase'); }, read: async () => saved });
  assert.deepEqual(repeated, result); assert.equal(calls, 2);
});

test('invalid screenplay stays invalid after bounded repair; next run resumes retained draft', async () => {
  const p = fixture(), bad = { episodes: [episodeFixtures().episodes[0]] };
  bad.episodes[0].plants = [];
  let calls = 0, saved;
  await assert.rejects(generateSeriesStage('episodes', p, undefined, {
    chat: async () => { calls++; return JSON.stringify(bad); }, save: async raw => { saved = raw; },
  }), /原稿已保留/);
  assert.equal(calls, 3); assert.equal(p.episodes.length, 0);
  await generateSeriesStage('episodes', p, undefined, {
    read: async () => saved,
    chat: async prompt => { assert.match(prompt, /待修原稿/); return JSON.stringify({ episodes: [episodeFixtures().episodes[0]] }); },
  });
});

test('develop saves each accepted episode; later failure never loses the first episode', async () => {
  const p = fixture(), previous = globalThis.fetch, checkpoints = [];
  let requested = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/companion/status') return Response.json({ ok: false });
    const body = JSON.parse(options.body);
    if (url === '/api/companion/series') { checkpoints.push(structuredClone(body.project)); return Response.json({ revision: body.project.revision + 1 }); }
    if (url === '/api/series/generate') {
      const n = body.project.episodes.length + 1; requested.push(n);
      if (n === 2) return Response.json({ error: 'provider unavailable' }, { status: 503 });
      return Response.json({ episodes: [{ ...episodeFixtures().episodes[0], id: 'ep-1', version: 1, deliveries: [] }] });
    }
    throw new Error(`unexpected ${url}`);
  };
  try {
    const claim = { project: p, job: { kind: 'develop', id: 'test', lease: 'test' }, settings: {} };
    await assert.rejects(executeSeriesClaim(claim, new AbortController().signal, () => {}), /provider unavailable/);
    assert.deepEqual(requested, [1, 2]); assert.equal(checkpoints.at(-1).episodes[0].id, 'ep-1');
    requested = [];
    await assert.rejects(executeSeriesClaim(claim, new AbortController().signal, () => {}));
    assert.deepEqual(requested, [2]);
  } finally { globalThis.fetch = previous; }
});

test('storage and account errors stop the candidate loop; only a known unusable voice permits the next candidate', async () => {
  const previous = globalThis.fetch;
  try {
    for (const code of ['VOICE_STORAGE_FAILED', 'VOICE_SYNTHESIS_FAILED', 'VOICE_UNAVAILABLE']) {
      const p = fixture(); p.characters = [p.characters[0]];
      const c = p.characters[0]; c.appearance = 'voice_only';
      p.locations.forEach(l => { l.imageUrl = 'https://assets.test/scene.png'; });
      let samples = 0, searches = 0;
      globalThis.fetch = async (url, options) => {
        if (url === '/api/companion/status') return Response.json({ ok: false });
        if (url === '/api/companion/series') return Response.json({ revision: JSON.parse(options.body).project.revision + 1 });
        if (url === '/api/series/voices') { searches++; return Response.json({ candidates: [{ voiceId: 'a', title: 'A' }, { voiceId: 'b', title: 'B' }] }); }
        if (url === '/api/generate-voice-reference') {
          samples++;
          if (samples === 1) return Response.json({ error: 'test failure', code }, { status: 500 });
          return Response.json({ voiceId: JSON.parse(options.body).voiceId, url: 'https://assets.test/b.mp3' });
        }
        throw new Error(`unexpected ${url}`);
      };
      const task = executeSeriesClaim({ project: p, job: { kind: 'prepare', id: 'test', lease: 'test' }, settings: {} }, new AbortController().signal, () => {});
      if (code === 'VOICE_UNAVAILABLE') { await task; assert.equal(samples, 2); }
      else {
        await assert.rejects(task, /test failure/); assert.equal(samples, 1);
        await executeSeriesClaim({ project: p, job: { kind: 'prepare', id: 'retry', lease: 'test' }, settings: {} }, new AbortController().signal, () => {});
        assert.equal(c.voiceId, 'a'); assert.equal(searches, 1, 'resume the saved candidate rather than discover a different voice');
      }
    }
  } finally { globalThis.fetch = previous; }
});

test('series search preserves ownership and license evidence; cross-language voices require audition', async () => {
  const previous = globalThis.fetch;
  const model = (_id, extra = {}) => ({ _id, title: 'English female warm', type: 'tts', state: 'trained', languages: ['en'], visibility: 'public', ...extra });
  const queries = [];
  globalThis.fetch = async url => {
    const params = new URL(url).searchParams; queries.push(params);
    if (params.has('self')) return Response.json({ items: [model('owned', { visibility: 'private', licensed: false }), model('occupied')], has_more: false });
    return Response.json({ items: [model('not-licensed', { licensed: false }), model('japanese', { title: 'female', languages: ['ja'], licensed: true }), model('retired', { licensed: true, pvc_release_state: 'retiring' })], has_more: false });
  };
  try {
    const result = await findSeriesVoices(fixture().characters[0], 'en', 'test', ['occupied']);
    assert.deepEqual(result.candidates.map(c => c.voiceId), ['owned', 'japanese']);
    assert.equal(result.candidates[1].requiresLanguageCheck, true);
    assert.equal(result.candidates[0].licensed, false); assert.equal(result.candidates[0].source, 'workspace');
    assert.equal(queries.length, 3); assert.equal(queries.find(q => q.has('licensed')).get('licensed'), 'true');
    await assert.rejects(findSeriesVoices(fixture().characters[0], 'en', 'test', ['owned', 'occupied', 'japanese']), /不会随机换声/);
  } finally { globalThis.fetch = previous; }
});

test('desktop uses a scoped hosted signature and direct large-file upload, never shipping cloud secrets or provider keys', async () => {
  const keys = ['CLOUDINARY_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_BACKUP_URL', 'CLOUDINARY_URL_BACKUP', 'AID_LOCAL_COMPANION'];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]])), previous = globalThis.fetch;
  try {
    keys.forEach(k => { delete process.env[k]; });
    process.env.CLOUDINARY_URL = 'cloudinary://public-key:private-secret@fixture-cloud';
    const options = { folder: 'aid-voice-refs', resource_type: 'video', public_id: 'voice-ref-timbre-v3-test', overwrite: true };
    const targets = createMediaUploadTickets(options);
    assert.ok(!JSON.stringify(targets).includes('private-secret')); assert.equal(targets[0].fields.overwrite, 'false');
    assert.throws(() => createMediaUploadTickets({ folder: '../unscoped', resource_type: 'video' }));
    assert.throws(() => createMediaUploadTickets({ ...options, public_id: '../other-asset' }));
    delete process.env.CLOUDINARY_URL; process.env.AID_LOCAL_COMPANION = '1';
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (url === 'https://pandais.beauty/api/media-upload/sign') {
        assert.deepEqual(JSON.parse(init.body), { folder: options.folder, resource_type: 'video', public_id: options.public_id });
        return Response.json({ targets });
      }
      assert.equal(url, targets[0].url); assert.equal(init.body.get('file').size, 7 * 1024 * 1024);
      assert.equal(init.body.get('overwrite'), 'false');
      return Response.json({ secure_url: 'https://assets.test/audio.mp3', duration: 6 });
    };
    const result = await uploadBufferToCloudinary(Buffer.alloc(7 * 1024 * 1024), options);
    assert.equal(result.duration, 6); assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previous;
    for (const k of keys) { if (original[k] === undefined) delete process.env[k]; else process.env[k] = original[k]; }
  }
});
