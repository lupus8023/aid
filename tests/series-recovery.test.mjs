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
import { parseEpisodes } from '../lib/series/domain.ts';
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

test('missing episode text is repaired by exact paths without rewriting valid story fields', async () => {
  const p = fixture();
  const good = episodeFixtures().episodes[0], broken = structuredClone(good);
  delete broken.synopsis;
  broken.opening = [];
  let cached = JSON.stringify({ episodes: [broken] }), calls = 0;
  assert.throws(() => parseEpisodes(JSON.parse(cached), p, 1, 1), error =>
    /episodes\[0\]\.synopsis/.test(error.message) && /episodes\[0\]\.opening/.test(error.message));
  const result = await generateSeriesStage('episodes', p, undefined, {
    read: async () => cached,
    save: async raw => { cached = raw; },
    chat: async prompt => {
      calls++;
      assert.match(prompt, /本轮仅补齐/);
      assert.match(prompt, /episodes\[0\]\.synopsis/);
      assert.match(prompt, /episodes\[0\]\.opening/);
      return JSON.stringify({ repairs: [
        { path: 'episodes[0].synopsis', value: good.synopsis },
        { path: 'episodes[0].opening', value: good.opening },
      ] });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(cached).episodes[0], good);
  assert.equal(result.episodes[0].synopsis, good.synopsis);
  await generateSeriesStage('episodes', p, undefined, { read: async () => cached, chat: async () => { throw new Error('duplicate generation'); } });
});

test('provider full-document repairs cannot change fields that were already valid', async () => {
  const p = fixture(), good = episodeFixtures().episodes[0], broken = structuredClone(good);
  delete broken.synopsis;
  const result = await generateSeriesStage('episodes', p, undefined, {
    read: async () => JSON.stringify({ episodes: [broken] }),
    chat: async () => JSON.stringify({ episodes: [{ ...good, title: 'unrequested rewrite', characterIds: ['unknown'], plants: [] }] }),
  });
  assert.equal(result.episodes[0].title, good.title);
  assert.deepEqual(result.episodes[0].characterIds, good.characterIds);
  assert.deepEqual(result.episodes[0].plants, good.plants);
});

test('invalid targeted repairs retain the original draft and stop after bounded attempts', async () => {
  const p = fixture(), broken = episodeFixtures().episodes[0];
  delete broken.synopsis;
  const original = JSON.stringify({ episodes: [broken] });
  let cached = original, calls = 0;
  await assert.rejects(generateSeriesStage('episodes', p, undefined, {
    read: async () => cached, save: async raw => { cached = raw; },
    chat: async () => {
      calls++;
      return JSON.stringify({ repairs: [{ path: 'episodes[0].title', value: 'replace correct title' }] });
    },
  }), /原稿已保留/);
  assert.equal(calls, 3);
  assert.equal(cached, original);
  assert.equal(p.episodes.length, 0);
});

test('filling missing text does not bypass semantic validation or overwrite user revisions', async () => {
  const p = fixture(), good = episodeFixtures().episodes[0], broken = structuredClone(good);
  p.episodeNotes = { 'ep-1': { synopsis: '用户锁定的原文' } };
  delete broken.synopsis;
  let calls = 0;
  await assert.rejects(generateSeriesStage('episodes', p, undefined, {
    read: async () => JSON.stringify({ episodes: [broken] }),
    chat: async () => {
      calls++;
      return calls === 1 ? JSON.stringify({ repairs: [{ path: 'episodes[0].synopsis', value: good.synopsis }] }) : JSON.stringify({ episodes: [good] });
    },
  }), /没有保留用户修改/);
  assert.equal(calls, 3);
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

test('a role with no automatic voice does not block later roles or locations; selection resumes without repeating assets', async () => {
  const previous = globalThis.fetch, p = fixture();
  p.characters.forEach(c => { c.bibleUrl = `https://assets.test/${c.id}.png`; });
  p.locations = [p.locations[0]];
  let samples = 0, images = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/companion/status') return Response.json({ ok: false });
    const body = JSON.parse(options.body);
    if (url === '/api/companion/series') return Response.json({ revision: body.project.revision + 1 });
    if (url === '/api/series/voices') return body.character.id === p.characters[0].id
      ? Response.json({ error: 'Choose a Fish voice', code: 'VOICE_SELECTION_REQUIRED' }, { status: 409 })
      : Response.json({ candidates: [{ voiceId: 'second-role', title: 'Second role' }] });
    if (url === '/api/generate-voice-reference') { samples++; return Response.json({ voiceId: body.voiceId, url: `https://assets.test/${body.voiceId}.mp3`, languageCheck: { passed: true, matchScore: 1 } }); }
    if (url === '/api/generate-costume') { images++; return Response.json({ taskId: 'location-task' }); }
    if (url === '/api/check-image-status') return Response.json({ status: 'completed', imageUrl: 'https://assets.test/location.png' });
    if (url === '/api/upload-image') return Response.json({ url: body.imageData });
    throw new Error(`unexpected ${url}`);
  };
  const claim = { project: p, job: { id: 'pending-voice', kind: 'prepare', lease: 'test' }, settings: {} };
  try {
    await assert.rejects(executeSeriesClaim(claim, new AbortController().signal, () => {}), e => e.code === 'VOICE_SELECTION_REQUIRED');
    assert.equal(p.characters[0].locked, false); assert.match(p.characters[0].voiceIssue, /Choose a Fish voice/);
    assert.equal(p.characters[1].locked, true); assert.ok(p.locations[0].imageUrl);
    assert.equal(samples, 1); assert.equal(images, 1);
    p.characters[0].voiceId = 'manually-selected'; p.characters[0].voiceSource = 'user';
    await executeSeriesClaim(claim, new AbortController().signal, () => {});
    assert.equal(p.characters[0].voiceIssue, undefined); assert.equal(p.characters[0].locked, true);
    assert.equal(samples, 2); assert.equal(images, 1);
  } finally { globalThis.fetch = previous; }
});

test('correcting a voice-only role generates only its missing card and keeps all fixed voices', async () => {
  const previous = globalThis.fetch, p = fixture();
  p.characters.forEach(c => Object.assign(c, { locked: true, voiceId: `voice-${c.id}`, voiceReferenceUrl: `https://assets.test/${c.id}.mp3`, bibleUrl: `https://assets.test/${c.id}.png` }));
  p.locations.forEach(l => { l.imageUrl = 'https://assets.test/scene.png'; });
  const king = p.characters[0]; king.bibleUrl = undefined; king.locked = false; king.appearance = 'on_screen';
  const narrator = { ...p.characters[1], id: 'narrator', name: 'Navi', appearance: 'voice_only', bibleUrl: undefined };
  p.characters.push(narrator);
  const preserved = structuredClone({ others: p.characters.slice(1), locations: p.locations });
  let submissions = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/companion/status') return Response.json({ ok: false });
    const body = JSON.parse(options.body);
    if (url === '/api/companion/series') return Response.json({ revision: body.project.revision + 1 });
    if (url === '/api/generate-costume') { submissions++; assert.equal(body.name, king.name); return Response.json({ taskId: 'king-card' }); }
    if (url === '/api/check-image-status') return Response.json({ status: 'completed', imageUrl: 'https://assets.test/king.png' });
    if (url === '/api/upload-image') return Response.json({ url: body.imageData });
    throw new Error(`must not regenerate voices or other assets: ${url}`);
  };
  try {
    const claim = { project: p, job: { kind: 'prepare', id: 'repair-card', lease: 'test' }, settings: {} };
    await executeSeriesClaim(claim, new AbortController().signal, () => {});
    await executeSeriesClaim(claim, new AbortController().signal, () => {});
    assert.equal(submissions, 1); assert.equal(king.locked, true); assert.equal(king.bibleUrl, 'https://assets.test/king.png');
    assert.equal(king.voiceId, 'voice-c1'); assert.equal(king.voiceReferenceUrl, 'https://assets.test/c1.mp3');
    assert.deepEqual({ others: p.characters.slice(1), locations: p.locations }, preserved);
  } finally { globalThis.fetch = previous; }
});

test('series search preserves ownership and license evidence; cross-language voices require audition', async () => {
  const previous = globalThis.fetch;
  const model = (_id, extra = {}) => ({ _id, title: 'English female warm', type: 'tts', state: 'trained', languages: ['en'], visibility: 'public', ...extra });
  const queries = [];
  globalThis.fetch = async url => {
    const params = new URL(url).searchParams; queries.push(params);
    if (params.has('self')) return Response.json({ items: [model('owned', { visibility: 'private', licensed: false }), model('occupied')], has_more: false });
    if (!params.has('licensed')) return Response.json({ items: [], has_more: false });
    return Response.json({ items: [model('not-licensed', { licensed: false }), model('japanese', { title: 'female', languages: ['ja'], licensed: true }), model('retired', { licensed: true, pvc_release_state: 'retiring' })], has_more: false });
  };
  try {
    const result = await findSeriesVoices(fixture().characters[0], 'en', 'test', ['occupied']);
    assert.deepEqual(result.candidates.map(c => c.voiceId), ['owned', 'japanese']);
    assert.equal(result.candidates[1].requiresLanguageCheck, true);
    assert.equal(result.candidates[0].licensed, false); assert.equal(result.candidates[0].source, 'workspace');
    assert.equal(queries.length, 4); assert.equal(queries.find(q => q.has('licensed')).get('licensed'), 'true');
    await assert.rejects(findSeriesVoices(fixture().characters[0], 'en', 'test', ['owned', 'occupied', 'japanese']), /不会随机更换/);
  } finally { globalThis.fetch = previous; }
});

test('automatic casting expands to Fish public voices when the safe small pool is exhausted, without claiming a license', async () => {
  const previous = globalThis.fetch, queries = [];
  const character = { ...fixture().characters[1], name: 'Archpriest Thalassor' };
  globalThis.fetch = async url => {
    const params = new URL(url).searchParams; queries.push(params);
    if (params.has('self') || params.has('licensed')) return Response.json({ items: [], has_more: false });
    assert.equal(params.get('title'), 'male'); assert.equal(params.get('language'), 'en');
    return Response.json({ items: [
      { _id: 'public-male', title: 'Senior male storyteller', languages: ['en'], licensed: false, state: 'trained' },
      { _id: 'already-used', title: 'Senior male storyteller', languages: ['en'], licensed: false },
      { _id: 'wrong-gender', title: 'Young female', languages: ['en'], licensed: false },
    ], has_more: false });
  };
  try {
    const result = await findSeriesVoices(character, 'en', 'test-key', ['already-used']);
    assert.deepEqual(result.candidates.map(c => c.voiceId), ['public-male']);
    assert.equal(result.candidates[0].source, 'public'); assert.equal(result.candidates[0].licensed, false);
    assert.equal(result.candidates[0].requiresLanguageCheck, true); assert.match(result.candidates[0].reason, /公共库/);
    assert.ok(queries.some(q => !q.has('self') && !q.has('licensed')));
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

test('script repair lists all overlong dialogue and preserves shot timing, speaker and visuals', async () => {
  const { shotFixture } = await import('./fixtures/series.mjs');
  const p = fixture(); p.language = 'en';
  p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  const raw = shotFixture();
  for (const i of [3, 6, 15]) raw.shots[i].dialogue = [{ characterId: 'c1', text: Array(22).fill('word').join(' '), emotion: 'worried' }];
  let draft = JSON.stringify(raw), calls = 0;
  const result = await generateSeriesStage('script', p, p.episodes[0].id, {
    read: async () => draft, save: async value => { draft = value; }, chat: async prompt => {
      calls++;
      for (const i of [3, 6, 15]) assert.ok(prompt.includes(`shots[${i}].dialogue[0].text`));
      return JSON.stringify({ repairs: [3, 6, 15].map(i => ({ path: `shots[${i}].dialogue[0].text`, value: 'I need to know the truth.' })) });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.script.length, 16);
  const expected = structuredClone(raw);
  for (const i of [3, 6, 15]) expected.shots[i].dialogue[0].text = 'I need to know the truth.';
  assert.deepEqual(JSON.parse(draft), expected);
  await generateSeriesStage('script', p, p.episodes[0].id, { read: async () => draft, chat: async () => assert.fail('cached script must be reused') });
});

test('asset-finalized script repair safely adds a valid speaker without another model call', async () => {
  const { shotFixture } = await import('./fixtures/series.mjs');
  const p = fixture();
  p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  const raw = shotFixture();
  raw.shots[4].characterIds = [];
  let draft = JSON.stringify(raw), calls = 0, saves = 0;
  const result = await generateSeriesStage('script', p, p.episodes[0].id, {
    read: async () => draft,
    save: async value => { draft = value; saves++; },
    chat: async () => { calls++; throw new Error('speaker repair must be deterministic'); },
  });
  assert.equal(calls, 0);
  assert.equal(saves, 1);
  assert.deepEqual(result.script[4].characterIds, ['c1']);
  assert.deepEqual(result.scriptAssetRepairs, [{ shotNumber: 5, kind: 'speaker_added', detail: '补入发声角色 林知夏' }]);
});

test('all ungrounded fixed props are reconciled in one bounded model repair', async () => {
  const { shotFixture } = await import('./fixtures/series.mjs');
  const p = fixture();
  p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  p.objects = [
    { id: 'bag', name: '金色面膜袋', aliases: ['袋装面膜'], description: '金色袋装面膜。', imageUrl: 'https://assets.test/bag.png', referenceMode: 'auto' },
    { id: 'mirror', name: '莲纹铜镜', aliases: ['铜镜'], description: '背面莲纹的铜镜。', imageUrl: 'https://assets.test/mirror.png', referenceMode: 'upload' },
  ];
  const raw = shotFixture();
  raw.shots[0].objectIds = ['bag'];
  raw.shots[0].visual = '近景，她拿起桌上的小袋子。';
  raw.shots[1].objectIds = ['mirror'];
  raw.shots[1].visual = '近景，她继续观察照片。';
  let draft = JSON.stringify(raw), calls = 0;
  const result = await generateSeriesStage('script', p, p.episodes[0].id, {
    read: async () => draft,
    save: async value => { draft = value; },
    chat: async prompt => {
      calls++;
      assert.match(prompt, /金色面膜袋/);
      assert.match(prompt, /莲纹铜镜/);
      return JSON.stringify({ repairs: [
        { shotNumber: 1, objectId: 'bag', decision: 'ground', field: 'visual', value: '近景，她拿起桌上的金色面膜袋。' },
        { shotNumber: 2, objectId: 'mirror', decision: 'remove' },
      ] });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.script[0].visual, '近景，她拿起桌上的金色面膜袋。');
  assert.deepEqual(result.script[0].objectIds, ['bag']);
  assert.deepEqual(result.script[1].objectIds, []);
  assert.deepEqual(result.scriptAssetRepairs.map(change => change.kind), ['object_grounded', 'object_removed']);
});

test('shot-count normalization preserves every dialogue turn and fixed-prop clue', async () => {
  const { shotFixture } = await import('./fixtures/series.mjs');
  const p = fixture();
  p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  const valid = shotFixture();
  const raw = structuredClone(valid);
  raw.shots.push({ ...structuredClone(raw.shots[15]), number: 17, seconds: 2, dialogue: [] });
  let draft = JSON.stringify(raw), calls = 0;
  const result = await generateSeriesStage('script', p, p.episodes[0].id, {
    read: async () => draft,
    save: async value => { draft = value; },
    chat: async prompt => {
      calls++;
      assert.match(prompt, /现有17镜/);
      return JSON.stringify(valid);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.script.length, 16);
  assert.equal(result.scriptAssetRepairs[0].kind, 'shot_count_normalized');
  assert.deepEqual(result.script.flatMap(shot => shot.dialogue), valid.shots.flatMap(shot => shot.dialogue));
});

test('dialogue repair rejects unsafe patches and cannot bypass timing or 16-shot validation', async () => {
  const { shotFixture } = await import('./fixtures/series.mjs');
  const { checkScriptDialogue, ScriptDialogueError, applyDialogueRepairs } = await import('../lib/series/scriptRepair.ts');
  const { parseScript } = await import('../lib/series/domain.ts');
  const p = fixture(); p.language = 'en'; p.episodes = parseEpisodes(episodeFixtures(), p, 1, 3);
  const raw = shotFixture();
  raw.shots[0].dialogue = ['c1', 'c2'].map(characterId => ({ characterId, text: Array(20).fill('word').join(' '), emotion: 'calm' }));
  raw.shots[0].characterIds = ['c1', 'c2'];
  let issues;
  assert.throws(() => checkScriptDialogue(raw.shots, 'en'), error => { issues = error.issues; return error instanceof ScriptDialogueError; });
  assert.equal(issues.length, 2); assert.ok(issues.reduce((n, i) => n + i.maxUnits, 0) <= 17);
  assert.throws(() => applyDialogueRepairs(raw, { repairs: [{ path: 'shots[0].seconds', value: '15' }, { path: issues[1].path, value: 'Fine.' }] }, issues), /仅可缩短/);
  const unchanged = applyDialogueRepairs(raw, { shots: raw.shots }, issues);
  assert.throws(() => parseScript(unchanged, p, p.episodes[0]), /台词超时/);
  assert.throws(() => parseScript({ shots: raw.shots.slice(1) }, p, p.episodes[0]), /16镜/);
  let saves = 0, calls = 0;
  await assert.rejects(generateSeriesStage('script', p, p.episodes[0].id, {
    read: async () => JSON.stringify(raw), save: async () => { saves++; }, chat: async () => { calls++; return '{"repairs":[]}'; },
  }), /原稿已保留/);
  assert.equal(calls, 3); assert.equal(saves, 0);
});

test('series binds exact structured dialogue before directing without reparsing role labels or losing lines', async () => {
  const { bindSeriesPlan, validateSeriesProduction } = await import('../lib/series/productionContract.ts');
  const shots = Array.from({ length: 16 }, (_, i) => ({ number: i + 1, seconds: i < 8 ? 8 : 7, characters: ['A', 'B'], action: `approved action ${i}`, visual: `approved visual ${i}`, purpose: `purpose ${i}`, dialogue: i === 0 ? [{ character: 'A', text: 'The name stays outside my words.', emotion: 'calm' }, { character: 'B', text: 'Both lines stay.', emotion: 'firm' }] : [] }));
  const contract = { shotCount: 16, voices: { A: 'fixed-a', B: 'fixed-b' }, shots, dialogue: shots.flatMap(s => s.dialogue) };
  const plan = { sequences: [{ beats: shots.map(s => ({ index: s.number, sourceShotRefs: [s.number], action: 'paraphrased action', durationHint: 10, characters: ['A'], speech: [{ character: 'A', exactLine: 'A：“wrong text”', voiceId: 'wrong' }], performance: [], dialogueTurns: [], cause: 'preserved causal direction' })) }] };
  const bound = bindSeriesPlan(contract, plan), beats = bound.sequences.flatMap(s => s.beats);
  validateSeriesProduction(contract, beats);
  assert.deepEqual(beats[0].speech.map(s => s.exactLine), shots[0].dialogue.map(s => s.text));
  assert.equal(beats[1].speech.length, 0); assert.equal(beats[0].action, shots[0].action);
  assert.equal(beats[0].cause, 'preserved causal direction'); assert.equal(bound.estimatedDurationSeconds, 120);
  assert.equal(plan.sequences[0].beats[0].action, 'paraphrased action', 'input remains untouched');
  const reordered = structuredClone(plan); reordered.sequences[0].beats[0].sourceShotRefs = [2];
  assert.throws(() => bindSeriesPlan(contract, reordered), /顺序/);
  const recast = structuredClone(contract); recast.shots[0].dialogue[0].character = 'C';
  assert.throws(() => bindSeriesPlan(recast, plan), /登记或音色/);
});
