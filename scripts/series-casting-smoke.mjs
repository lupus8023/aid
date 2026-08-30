// Use an isolated data directory and loopback server. No provider calls or real credentials.
import assert from 'node:assert/strict';
import { parseOutline, parseEpisodes } from '../lib/series/domain.ts';
import { outlineFixture, episodeFixtures } from '../tests/fixtures/series.mjs';
const base = process.argv[2];
assert.ok(base && ['localhost', '127.0.0.1'].includes(new URL(base).hostname));
async function request(body) {
  const r = await fetch(`${base}/api/companion/series`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
}
const actor = { id: 'qa-library-actor', name: '测试演员·林岚', description: '测试外形资料', imageUrl: 'https://pandais.beauty/icon.png', bibleUrl: 'https://pandais.beauty/icon.png', voiceId: 'qa-saved-voice-never-synthesize' };
const workerId = `casting-qa-${crypto.randomUUID()}`;
const settings = { apiKey: 'qa-placeholder-never-send', fishAudioKey: 'qa-placeholder-never-send' };
await request({ action: 'claim', workerId, mode: 'companion' });
let { project } = await request({ action: 'create', project: { name: '角色库选角 · 验证样例', brief: '角色库验证用虚构故事', episodeCount: 3 } });
const seriesId = project.id;
await request({ action: 'enqueue', seriesId, kind: 'develop', settings });
const { claim } = await request({ action: 'claim', workerId, mode: 'companion' });
await assert.rejects(request({ action: 'cast-character', seriesId, revision: project.revision, characterId: 'c1', actor }), /暂停/);
Object.assign(claim.project, parseOutline(outlineFixture(), claim.project));
claim.project.episodes = parseEpisodes(episodeFixtures(), claim.project, 1, 3);
await request({ action: 'checkpoint', jobId: claim.job.id, lease: claim.job.lease, project: claim.project, stage: 'Fixture ready' });
await request({ action: 'finish', jobId: claim.job.id, lease: claim.job.lease });
await request({ action: 'pause', seriesId });
project = (await fetch(`${base}/api/companion/series`).then(r=>r.json())).projects.find(p=>p.id===seriesId);
const revision = project.revision;
await assert.rejects(request({ action: 'cast-character', seriesId, revision: 1, characterId: 'c1', actor }), /已有更新/);
await assert.rejects(request({ action: 'cast-character', seriesId, revision, characterId: 'c1', actor: { ...actor, imageUrl: 'http://unsafe.test/photo.png' } }), /HTTPS/);
const response = await request({ action: 'cast-character', seriesId, revision, characterId: 'c1', actor });
assert.equal(response.project.characters[0].name, project.characters[0].name);
assert.equal(response.project.characters[0].casting.name, actor.name);
assert.equal(response.project.characters[0].bibleUrl, actor.bibleUrl);
assert.equal(response.project.characters[0].voiceId, actor.voiceId);
const repeated = await request({ action: 'cast-character', seriesId, revision: response.project.revision, characterId: 'c1', actor });
assert.equal(repeated.project.revision, response.project.revision);
assert.equal(repeated.project.episodes[0].version, response.project.episodes[0].version);
console.log(JSON.stringify({ ok: true, seriesId, checks: ['busy queue guarded', 'stale revision guarded', 'unsafe URL rejected', 'identity retained', 'library image and voice reused', 'same actor is idempotent'] }, null, 2));
