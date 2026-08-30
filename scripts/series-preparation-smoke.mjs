// Only run against an isolated loopback development server. No real provider calls.
import assert from 'node:assert/strict';
import { parseOutline } from '../lib/series/domain.ts';
import { outlineFixture } from '../tests/fixtures/series.mjs';
const base = process.argv[2];
assert.ok(base && ['localhost', '127.0.0.1'].includes(new URL(base).hostname));
async function request(body) {
  const r = await fetch(`${base}/api/companion/series`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
}
const workerId = `preparation-qa-${crypto.randomUUID()}`;
const settings = { apiKey: 'fixture-never-send', fishAudioKey: 'fixture-never-send' };
await request({ action: 'claim', workerId, mode: 'companion' });
const { project } = await request({ action: 'create', project: { name: '独立定稿 · 图片回退验证', brief: '不调用模型的隔离样例', episodeCount: 3 } });
const seriesId = project.id;
await assert.rejects(request({ action: 'enqueue', seriesId, kind: 'prepare', settings }), /总纲/);
await request({ action: 'enqueue', seriesId, kind: 'develop', settings });
const { claim: development } = await request({ action: 'claim', workerId, mode: 'companion' });
assert.equal(development.project.id, seriesId);
Object.assign(development.project, parseOutline(outlineFixture(), development.project));
await request({ action: 'checkpoint', jobId: development.job.id, lease: development.job.lease, project: development.project, stage: 'Outline saved' });
await request({ action: 'finish', jobId: development.job.id, lease: development.job.lease, error: '验证：第1集遗漏应埋设伏笔 p1' });
for (const kind of ['script', 'produce']) await assert.rejects(request({ action: 'enqueue', seriesId, kind, settings }), /分集故事/);
assert.equal((await request({ action: 'enqueue', seriesId, kind: 'prepare', settings: { fishAudioKey: settings.fishAudioKey } })).added, 1);
assert.equal((await request({ action: 'enqueue', seriesId, kind: 'prepare', settings })).added, 0);
const { claim } = await request({ action: 'claim', workerId, mode: 'companion' });
assert.equal(claim.job.kind, 'prepare');
await assert.rejects(request({ action: 'finish', jobId: claim.job.id, lease: claim.job.lease }), /尚未定稿/);
claim.project.characters.forEach(c => { c.bibleUrl = 'https://pandais.beauty/icon.png'; c.imageUrl = c.bibleUrl; c.voiceId = `fixture-${c.id}`; c.voiceReferenceUrl = 'https://assets.test/voice.mp3'; c.locked = true; });
claim.project.locations.forEach(l => { l.imageUrl = 'https://pandais.beauty/icon.png'; });
await request({ action: 'checkpoint', jobId: claim.job.id, lease: claim.job.lease, project: claim.project, stage: 'Assets ready, no episodes' });
await request({ action: 'finish', jobId: claim.job.id, lease: claim.job.lease });
await request({ action: 'pause', seriesId });
const snapshot = await fetch(`${base}/api/companion/series`).then(r => r.json());
assert.equal(snapshot.projects.find(p => p.id === seriesId).episodes.length, 0);
assert.equal(snapshot.jobs.find(j => j.id === development.job.id).status, 'failed');
console.log(JSON.stringify({ ok: true, seriesId, checks: ['outline prerequisite', 'no episodes preparation', 'no script key required for preparation', 'duplicate queue guard', 'incomplete assets cannot finish', 'script/produce stay blocked', 'failed development retained'] }));
