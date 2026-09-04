import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generationDraft, recoverGeneration } from '../lib/pipeline/generationDraft.ts';
import { canResumeStoryPlan } from '../lib/pipeline/resumePlan.ts';
import { storyCastKey } from '../lib/pipeline/storyCastAdaptation.ts';

test('retains a failed batch, repairs it after restart and reuses a validated result without a provider call', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aid-pipeline-draft-'));
  const old = process.env.AID_COMPANION_DATA_DIR; process.env.AID_COMPANION_DATA_DIR = root;
  const identity = ['prompt', 'model', 'private-fixture-key'];
  const parse = raw => { const value = JSON.parse(raw); if (!value.complete) throw Error('missing complete'); return value; };
  try {
    await assert.rejects(recoverGeneration({ draft: generationDraft('test', identity), parse, attempts: 1, generate: async () => '{"action":"keep this"}' }), /missing complete/);
    let calls = 0;
    const value = await recoverGeneration({ draft: generationDraft('test', identity), parse, attempts: 2, generate: async (draft, error) => {
      calls++; assert.deepEqual(JSON.parse(draft), { action: 'keep this' }); assert.match(error.message, /missing complete/);
      return '{"action":"keep this","complete":true}';
    } });
    assert.equal(calls, 1); assert.equal(value.action, 'keep this');
    assert.deepEqual(await recoverGeneration({ draft: generationDraft('test', identity), parse, attempts: 2, generate: async () => assert.fail('must reuse saved batch') }), value);
    assert.equal(await generationDraft('test', ['different input']).read(), undefined);
    for (const file of await readdir(path.join(root, 'pipeline-drafts'))) {
      assert.match(file, /^[a-f0-9]{64}\.txt$/);
      assert.doesNotMatch(await readFile(path.join(root, 'pipeline-drafts', file), 'utf8'), /private-fixture-key/);
    }
  } finally {
    if (old === undefined) delete process.env.AID_COMPANION_DATA_DIR; else process.env.AID_COMPANION_DATA_DIR = old;
    await rm(root, { recursive: true, force: true });
  }
});

test('transport failures retain the original and honor the retry bound', async () => {
  let raw = '{"complete":false}', calls = 0, saves = 0;
  await assert.rejects(recoverGeneration({ draft: { read: async () => raw, save: async value => { raw = value; saves++; } }, attempts: 3,
    parse: () => { throw Error('invalid'); }, generate: async previous => { assert.equal(previous, raw); calls++; throw Error('offline'); },
  }), /offline/);
  assert.equal(calls, 3); assert.equal(saves, 0); assert.equal(raw, '{"complete":false}');
});

test('automatic resume reuses only an unchanged source, shot count and voice cast', () => {
  const plan = { sourceBrief: 'approved script', characters: [{ name: 'A', voiceId: 'fixed' }], sequences: [{ beats: [{ index: 1 }, { index: 2 }] }] };
  const cast = [{ name: 'A', voiceId: 'fixed' }];
  assert.equal(canResumeStoryPlan(plan, 'approved script', 2, cast), false, 'legacy ordinary plans must first adapt their cast');
  assert.equal(canResumeStoryPlan({ ...plan, seriesEpisode: { seriesId: 'series', episodeId: 'ep-1' } }, 'approved script', 2, cast), true, 'approved series contracts are not recast');
  plan.castAdaptation = { castKey: storyCastKey(cast) };
  assert.equal(canResumeStoryPlan(plan, 'approved script', 2, cast), true);
  assert.equal(canResumeStoryPlan(plan, 'edited script', 2, cast), false);
  assert.equal(canResumeStoryPlan(plan, 'approved script', 3, cast), false);
  assert.equal(canResumeStoryPlan(plan, 'approved script', 2, [{ name: 'A', voiceId: 'new' }]), false);
  assert.equal(canResumeStoryPlan(plan, 'approved script', 2, [{ ...cast[0], description: 'different story identity' }]), false);
  assert.equal(canResumeStoryPlan(plan, 'approved script', 2, [{ ...cast[0], id: 'replacement-card' }]), false);
});
