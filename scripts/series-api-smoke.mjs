// Against an isolated local dev server only. Seeds authored fixtures through the
// normal queue/checkpoint APIs; never calls model providers or uses real keys.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSeries, parseOutline, parseEpisodes, parseScript } from '../lib/series/domain.ts';
import { outlineFixture, episodeFixtures, shotFixture } from '../tests/fixtures/series.mjs';

const origin = process.argv[2] || 'http://localhost:3027';
const aspectRatio = process.argv[3] || '9:16';
assert.ok(['9:16', '16:9', '1:1'].includes(aspectRatio));
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Only isolated loopback test servers are supported');
const request = async body => {
  const response = await fetch(`${origin}/api/companion/series`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
};
const snapshot = () => fetch(`${origin}/api/companion/series`).then(r => r.json());
const workerId = `smoke-${crypto.randomUUID()}`;
const settings = { apiKey: 'qa-placeholder-never-send-to-provider', fishAudioKey: 'qa-placeholder', scriptModel: 'qa', imageModel: 'qa', videoModel: 'qa' };
const temp = await mkdtemp(path.join(os.tmpdir(), 'series-film-'));
try {
  // Register our controlled worker first so a page worker cannot take test jobs.
  await request({ action: 'claim', workerId, mode: 'companion' });
  const { project } = await request({ action: 'create', project: { name: '回声档案 · 流程验证', brief: '照片重现十秒往事，调查以记忆为代价。（测试数据）', episodeCount: 3, aspectRatio } });
  assert.equal(project.aspectRatio, aspectRatio);
  const seriesId = project.id;
  assert.equal((await request({ action: 'enqueue', seriesId, kind: 'develop', settings })).added, 1);
  assert.equal((await request({ action: 'enqueue', seriesId, kind: 'develop', settings })).added, 0);
  const queued = (await snapshot()).jobs.find(j => j.seriesId === seriesId);
  await assert.rejects(request({ action: 'delete-job', seriesId, jobId: queued.id }), /只能删除失败任务/);
  const { claim } = await request({ action: 'claim', workerId, mode: 'companion' });
  assert.equal(claim.job.seriesId, seriesId);
  await assert.rejects(request({ action: 'delete-job', seriesId, jobId: claim.job.id }), /只能删除失败任务/);
  assert.equal((await request({ action: 'claim', workerId: 'other-worker', mode: 'page' })).claim, null);
  Object.assign(claim.project, parseOutline(outlineFixture(), claim.project));
  claim.project.episodes = parseEpisodes(episodeFixtures(), claim.project, 1, 3);
  for (const episode of claim.project.episodes) episode.script = parseScript(shotFixture(), claim.project, episode);
  const saved = await request({ action: 'checkpoint', jobId: claim.job.id, lease: claim.job.lease, project: claim.project, stage: 'Fixture generation completed' });
  assert.equal(saved.revision, project.revision + 1);
  await assert.rejects(request({ action: 'checkpoint', jobId: claim.job.id, lease: 'wrong', project: claim.project }), /租约已失效/);
  await request({ action: 'finish', jobId: claim.job.id, lease: claim.job.lease });
  await assert.rejects(request({ action: 'delete-job', seriesId, jobId: claim.job.id }), /只能删除失败任务/);
  assert.doesNotMatch(JSON.stringify(await snapshot()), /qa-placeholder|sealedSettings|lease-/);
  assert.equal((await request({ action: 'enqueue', seriesId, kind: 'produce', settings, episodeIds: ['ep-1', 'ep-2'] })).added, 2);
  const running = (await request({ action: 'claim', workerId, mode: 'companion' })).claim;
  await request({ action: 'pause', seriesId });
  assert.equal((await request({ action: 'heartbeat', jobId: running.job.id, lease: running.job.lease })).continue, false);
  await request({ action: 'finish', jobId: running.job.id, lease: running.job.lease, paused: true, error: '已暂停' });
  await assert.rejects(request({ action: 'delete-job', seriesId, jobId: running.job.id }), /只能删除失败任务/);
  assert.ok((await snapshot()).jobs.filter(j => j.seriesId === seriesId && j.kind === 'produce').every(j => j.status === 'paused'));
  await request({ action: 'resume', seriesId });
  const resumed = (await request({ action: 'claim', workerId, mode: 'companion' })).claim;
  assert.equal(resumed.job.id, running.job.id);
  assert.equal(resumed.job.error, undefined, 'resume clears the previous pause error');
  assert.notEqual(resumed.job.lease, running.job.lease);

  const require = createRequire(import.meta.url), file = path.join(temp, 'fixture.mp4');
  const generateFilm = (size, output) => execFileSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x252036:s=${size}:r=1:d=120`, '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '120', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-movflags', '+faststart', output]);
  if (aspectRatio === '1:1') {
    const wrongFile = path.join(temp, 'wrong-portrait.mp4');
    generateFilm('180x320', wrongFile);
    const rejected = await fetch(`${origin}/api/companion/series/delivery?jobId=${resumed.job.id}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-AID-Lease': resumed.job.lease }, body: await readFile(wrongFile) });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /画幅/);
  }
  generateFilm(aspectRatio === '1:1' ? '180x180' : aspectRatio === '16:9' ? '320x180' : '180x320', file);
  const film = await readFile(file);
  const delivery = await fetch(`${origin}/api/companion/series/delivery?jobId=${resumed.job.id}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-AID-Lease': resumed.job.lease }, body: film });
  assert.equal(delivery.status, 200, await delivery.text());
  await request({ action: 'finish', jobId: resumed.job.id, lease: resumed.job.lease });
  await request({ action: 'pause', seriesId });
  let current = (await snapshot()).projects.find(p => p.id === seriesId);
  assert.equal(current.episodes[0].deliveries.length, 1);
  const url = `${origin}/api/companion/series/delivery?seriesId=${seriesId}&id=${resumed.job.id}`;
  const partial = await fetch(url, { headers: { Range: 'bytes=0-31' } });
  assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 32);
  const downloaded = await fetch(`${url}&download=1`);
  assert.match(downloaded.headers.get('content-disposition'), /attachment/);
  assert.equal((await downloaded.arrayBuffer()).byteLength, film.byteLength);
  await request({ action: 'edit', seriesId, revision: current.revision, episodeId: 'ep-1', patch: { hook: '镜头停在陈叔手腕上那块已经停走的表。' } });
  current = (await snapshot()).projects.find(p => p.id === seriesId);
  assert.equal(current.episodes[0].deliveries.length, 1); assert.equal(current.episodes[0].version, 2);
  assert.ok(current.episodes[1].needsReview); assert.equal(current.episodes[0].script, undefined);
  assert.equal((await fetch(url)).status, 200, 'old delivered version stays downloadable');
  await assert.rejects(request({ action: 'edit', seriesId, revision: 1, patch: { name: 'stale writer' } }), /已有更新/);

  // Delete both historical and current failures without touching project data,
  // other queue entries, or media. Each GET reloads the persisted database.
  const failures = [];
  for (let i = 0; i < 2; i++) {
    await request({ action: 'enqueue', seriesId, kind: 'develop', settings });
    const failed = (await request({ action: 'claim', workerId, mode: 'companion' })).claim;
    await request({ action: 'finish', jobId: failed.job.id, lease: failed.job.lease, error: `受控失败 ${i + 1}` });
    failures.push(failed.job);
  }
  const other = (await request({ action: 'create', project: { name: '删除隔离验证', brief: '测试数据', episodeCount: 2 } })).project;
  await assert.rejects(request({ action: 'delete-job', seriesId: other.id, jobId: failures[0].id }), /任务不存在/);
  const beforeDelete = await snapshot();
  for (const failed of failures) {
    await request({ action: 'delete-job', seriesId, jobId: failed.id });
    await assert.rejects(request({ action: 'delete-job', seriesId, jobId: failed.id }), /任务不存在或已删除/);
    await assert.rejects(request({ action: 'retry', seriesId, jobId: failed.id, settings }), /任务不处于失败状态/);
    await assert.rejects(request({ action: 'checkpoint', jobId: failed.id, lease: failed.lease, project: current }), /租约已失效/);
  }
  const afterDelete = await snapshot();
  assert.deepEqual(afterDelete.projects, beforeDelete.projects, 'deleting failures preserves every project and checkpoint');
  assert.deepEqual(afterDelete.jobs, beforeDelete.jobs.filter(j => !failures.some(f => f.id === j.id)), 'only the requested records disappear');
  assert.equal((await fetch(url)).status, 200, 'delivered video is still downloadable after task deletion');

  // A stale delete must not remove a task that was retried in another page.
  await request({ action: 'enqueue', seriesId, kind: 'develop', settings });
  const retrying = (await request({ action: 'claim', workerId, mode: 'companion' })).claim;
  await request({ action: 'finish', jobId: retrying.job.id, lease: retrying.job.lease, error: '重试竞争验证' });
  await request({ action: 'retry', seriesId, jobId: retrying.job.id, settings });
  await assert.rejects(request({ action: 'delete-job', seriesId, jobId: retrying.job.id }), /只能删除失败任务/);
  await request({ action: 'pause', seriesId });
  console.log(JSON.stringify({ ok: true, seriesId, checks: ['deduplication', 'exclusive lease', 'stale lease rejection', 'credential redaction', 'pause/resume', 'validated video upload', 'range playback', 'download', 'revision conflict', 'downstream invalidation', 'old delivery retention', 'persistent failure deletion', 'project and media preservation', 'cross-project deletion rejection', 'active and completed task protection', 'stale delete after retry rejection'] }, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
