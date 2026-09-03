import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSeriesClaim } from '../lib/series/runner.ts';
import { createSeries, parseOutline, parseEpisodes, parseScript } from '../lib/series/domain.ts';
import { storyStorageKeys } from '../lib/series/storageScope.ts';
import { outlineFixture, episodeFixtures, shotFixture } from './fixtures/series.mjs';

test('script runner records the asset-authoritative reverse repair before finalizing', async () => {
  const project = createSeries({ name: '反向修稿记录', brief: 'test', episodeCount: 3 });
  Object.assign(project, parseOutline(outlineFixture(), project));
  project.episodes = parseEpisodes(episodeFixtures(), project, 1, 3);
  project.characters.forEach((character, index) => {
    character.locked = true;
    character.bibleUrl = `https://assets.test/character-${index}.png`;
    character.voiceId = `voice-${index}`;
    character.voiceReferenceUrl = `https://assets.test/voice-${index}.mp3`;
  });
  project.locations.forEach(location => { location.imageUrl = `https://assets.test/${location.id}.png`; });
  project.episodes[0].script = parseScript(shotFixture(), project, project.episodes[0]);
  project.episodes[0].scriptAssetFingerprint = 'pre-final-assets';
  const previousFetch = globalThis.fetch;
  const stages = [];
  globalThis.fetch = async (url, init) => {
    if (url === '/api/companion/status') return Response.json({ ok: true });
    const body = JSON.parse(init.body);
    if (url === '/api/series/generate') return Response.json({
      script: parseScript(shotFixture(), project, project.episodes[0]),
      scriptAssetRepairs: [{ shotNumber: 5, kind: 'speaker_added', detail: '补入发声角色 林知夏' }],
    });
    if (url === '/api/companion/series') {
      stages.push(body.stage);
      return Response.json({ revision: body.project.revision + 1 });
    }
    throw new Error(`Unexpected ${url}`);
  };
  try {
    await executeSeriesClaim({
      project,
      job: { id: 'script-job', episodeId: project.episodes[0].id, kind: 'script', lease: 'fixture' },
      settings: { apiKey: 'fixture' },
    }, new AbortController().signal, () => {});
    assert.equal(project.episodes[0].scriptAssetRepairs.length, 1);
    assert.equal(project.episodes[0].scriptAssetRepairs[0].changes[0].kind, 'speaker_added');
    assert.ok(stages.some(stage => /按最终角色与道具反向修正 1 处/.test(stage)));
    assert.ok(stages.some(stage => /按最终角色与道具复核18镜剧本/.test(stage)));
    assert.match(stages.at(-1), /18镜已定稿/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

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

test('one rejected MJ card does not stop other cards and scenes, and a restart buys no duplicates', async () => {
  const project = createSeries({ name: 'MJ preparation', brief: 'test', episodeCount: 3 });
  Object.assign(project, parseOutline(outlineFixture(), project));
  project.characters.forEach(c => { c.locked = false; c.voiceId = `voice-${c.id}`; c.voiceReferenceUrl = 'https://assets.test/voice.mp3'; });
  project.characters[0].imageTaskId = 'rejected-task';
  project.objects = [{ id: 'o1', name: '铜镜', aliases: [], description: '椭圆青铜镜，背面莲纹。', imageUrl: '', referenceMode: 'auto' }];
  const saved = {fetch:globalThis.fetch, setTimeout:globalThis.setTimeout};
  const submissions=[],polls=[],stages=[];
  globalThis.setTimeout = (fn, delay, ...args) => saved.setTimeout(fn, delay === 3000 ? 0 : delay, ...args);
  globalThis.fetch = async (url, init) => {
    if(url==='/api/companion/status') return Response.json({ok:false});
    const body = JSON.parse(init.body);
    if(url==='/api/companion/series') { stages.push(body.stage);return Response.json({revision:body.project.revision+1}); }
    if(url==='/api/generate-costume') { submissions.push(body);return Response.json({taskId:`paid-${submissions.length}`}); }
    if(url==='/api/check-image-status') { polls.push(body.taskId);return Response.json(body.taskId==='rejected-task' ? {status:'failed',error:'Prompt图片未通过审核'} : {status:'completed',imageUrl:`https://assets.test/${body.taskId}.png`}); }
    if(url==='/api/upload-image') return Response.json({url:body.imageData});
    throw Error(`Unexpected ${url}`);
  };
  try {
    const claim={project,job:{id:'prepare',kind:'prepare',lease:'test'},settings:{imageModel:'midjourney'}};
    await assert.rejects(executeSeriesClaim(claim,new AbortController().signal,()=>{}),/1 项图像待处理/);
    assert.equal(project.characters[0].locked,false);
    assert.equal(project.characters[0].imageIssue.kind,'review');
    assert.ok(project.characters.slice(1).every(c=>c.locked && c.bibleUrl));
    assert.ok(project.locations.every(l=>l.imageUrl));
    assert.ok(project.objects[0].imageUrl);
    const count=submissions.length;
    assert.equal(count,project.characters.length-1+project.locations.length+1);
    assert.equal(submissions.filter(item=>item.type==='object').length,1);
    await assert.rejects(executeSeriesClaim(claim,new AbortController().signal,()=>{}),/1 项图像待处理/);
    assert.equal(submissions.length,count);
    assert.equal(polls.filter(id=>id==='rejected-task').length,2);
    assert.ok(stages.some(s=>s.includes('继续准备其余素材')));
  } finally { Object.assign(globalThis,saved); }
});

test('a targeted character-card job generates only that card', async () => {
  const project = createSeries({ name: '单张角色卡', brief: 'test', episodeCount: 3 });
  Object.assign(project, parseOutline(outlineFixture(), project));
  project.objects = [{ id: 'o1', name: '铜镜', aliases: [], description: '椭圆青铜镜。', imageUrl: '', referenceMode: 'auto' }];
  const target = project.characters[0];
  const saved = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  const submissions = [];
  globalThis.setTimeout = (fn, delay, ...args) => saved.setTimeout(fn, delay === 3000 ? 0 : delay, ...args);
  globalThis.fetch = async (url, init) => {
    if (url === '/api/companion/status') return Response.json({ ok: false });
    const body = JSON.parse(init.body);
    if (url === '/api/companion/series') return Response.json({ revision: body.project.revision + 1 });
    if (url === '/api/generate-costume') { submissions.push(body); return Response.json({ taskId: 'target-card' }); }
    if (url === '/api/check-image-status') return Response.json({ status: 'completed', imageUrl: 'https://assets.test/target-card.png' });
    if (url === '/api/upload-image') return Response.json({ url: body.imageData });
    throw new Error(`Unexpected ${url}`);
  };
  try {
    await executeSeriesClaim({
      project,
      job: { id: 'targeted', kind: 'prepare', assetId: target.id, lease: 'fixture' },
      settings: { imageModel: 'fixture-image' },
    }, new AbortController().signal, () => {});
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].type, 'costume');
    assert.equal(submissions[0].name, target.name);
    assert.equal(target.bibleUrl, 'https://assets.test/target-card.png');
    assert.ok(project.characters.slice(1).every(character => !character.bibleUrl));
    assert.ok(project.locations.every(location => !location.imageUrl));
    assert.equal(project.objects[0].imageUrl, '');
  } finally {
    Object.assign(globalThis, saved);
  }
});

test('photographic preparation uses the reviewed single card, checkpoints submission identity, and skips unused sheets', async () => {
 const project=createSeries({name:'Photo preparation',brief:'test',episodeCount:3});
 Object.assign(project,parseOutline(outlineFixture(),project));
 project.characters.forEach(c=>{c.locked=false;c.voiceId=`voice-${c.id}`;c.voiceReferenceUrl='https://assets.test/voice.mp3';});
 project.styleReference={imageUrl:'https://assets.test/style.png',description:'Warm light, cool ambient.'};
 const saved={fetch:globalThis.fetch,setTimeout:globalThis.setTimeout};
 const submissions=[],checkpoints=[];
 globalThis.setTimeout=(fn,delay,...args)=>saved.setTimeout(fn,delay===3000?0:delay,...args);
 globalThis.fetch=async(url,init)=>{
  if(url==='/api/companion/status')return Response.json({ok:false});
  const body=JSON.parse(init.body);
  if(url==='/api/companion/series'){checkpoints.push(structuredClone(body.project));return Response.json({revision:body.project.revision+1});}
  if(url==='/api/generate-costume'){
   assert.ok(body.imageSubmissionKey);
   assert.ok(JSON.stringify(checkpoints.at(-1)).includes(body.imageSubmissionKey),'key persisted before purchase');
   assert.equal(body.styleReference.imageUrl,project.styleReference.imageUrl);
   submissions.push(body);return Response.json({taskId:`paid-${submissions.length}`});
  }
  if(url==='/api/check-image-status')return Response.json({status:'completed',imageUrl:`https://assets.test/${body.taskId}.png`});
  if(url==='/api/upload-image')return Response.json({url:body.imageData});
  if(url==='/api/series/audit-appearance')return Response.json({photographic:true,issues:[]});
  throw Error(`Unexpected ${url}`);
 };
 try{
  const claim={project,job:{id:'prepare',kind:'prepare',lease:'test'},settings:{imageModel:'gpt-image-2'}};
  await executeSeriesClaim(claim,new AbortController().signal,()=>{});
  assert.equal(submissions.filter(s=>s.type==='costume').length,0);
  assert.equal(submissions.filter(s=>s.type==='costume-anchor').length,project.characters.length);
  assert.ok(project.characters.every(c=>c.bibleUrl===c.photographicAnchor.imageUrl&&c.locked));
  const count=submissions.length;
  await executeSeriesClaim(claim,new AbortController().signal,()=>{});
  assert.equal(submissions.length,count);
 }finally{Object.assign(globalThis,saved);}
});
