// Fresh, isolated localhost data only. Controlled workers never call providers.
import assert from 'node:assert/strict';
import { parseOutline } from '../lib/series/domain.ts';
import { outlineFixture } from '../tests/fixtures/series.mjs';
const base = process.argv[2];
assert.ok(base && ['localhost', '127.0.0.1'].includes(new URL(base).hostname));
async function call(body) {
  const r = await fetch(base + '/api/companion/series', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
}
const snapshot = () => fetch(base + '/api/companion/series').then(r => r.json());
assert.equal((await snapshot()).projects.length, 0, 'Use a fresh empty test server');
const workerId = 'history-test-' + crypto.randomUUID(), settings = { apiKey: 'fixture-not-for-provider', fishAudioKey: 'fixture-not-for-provider' };
await call({ action: 'claim', workerId, mode: 'companion' });
const { project } = await call({ action: 'create', project: { name: '声音恢复 · 历史任务验证', brief: '隔离流程测试', episodeCount: 3 } });
const seriesId = project.id;
await call({ action: 'enqueue', seriesId, kind: 'develop', settings });
const { claim } = await call({ action: 'claim', workerId, mode: 'companion' });
Object.assign(claim.project, parseOutline(outlineFixture(), claim.project));
await call({ action: 'checkpoint', jobId: claim.job.id, lease: claim.job.lease, project: claim.project });
await call({ action: 'finish', jobId: claim.job.id, lease: claim.job.lease, error: '旧分集未完成：本测试不请求编剧服务' });
const jobs = [];
for (const error of ['历史上传失败（测试记录）', '当前试音待继续（测试记录）']) {
  await call({ action: 'enqueue', seriesId, kind: 'prepare', settings });
  const { claim } = await call({ action: 'claim', workerId, mode: 'companion' });
  jobs.push(claim.job.id);
  await call({ action: 'finish', jobId: claim.job.id, lease: claim.job.lease, error });
}
await assert.rejects(call({ action: 'retry', jobId: jobs[0] }), /历史任务/);
await call({ action: 'retry', jobId: jobs[1] });
await assert.rejects(call({ action: 'retry', jobId: jobs[0] }), /已有排队/);
await call({ action: 'pause', seriesId });
const after = await snapshot();
assert.equal(after.jobs.find(j => j.id === jobs[0]).status, 'failed');
assert.equal(after.jobs.find(j => j.id === jobs[1]).status, 'paused');
assert.ok(!after.jobs.some(j => j.status === 'running' || j.status === 'queued'));
console.log(JSON.stringify({ ok: true, seriesId, checks: ['history preserved', 'historical retry rejected', 'current retry accepted', 'duplicate retry rejected', 'queue paused without provider calls'] }));
