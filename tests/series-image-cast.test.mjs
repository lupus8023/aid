import assert from 'node:assert/strict';
import test from 'node:test';
import { auditImageCast, parseImageCastCheck, imageForCastAudit } from '../lib/series/imageCastAudit.ts';
import { prepareImageCastRepair, visibleImageCast } from '../lib/series/imageCastContract.ts';
import { chatInputContent, responsesInput } from '../lib/pipeline/providerPayload.ts';

const cast = [
  { name: 'Luna', description: 'A short-haired mermaid in a blue coat.', imageUrl: 'https://res.cloudinary.com/test/luna.jpg' },
  { name: 'Rill', description: 'An eel courier with a gold sash; no human body.', imageUrl: 'https://res.cloudinary.com/test/rill.jpg' },
  { name: 'Navi', description: 'Disembodied narration', appearance: 'voice_only' },
];
const board = { id: 's18', sceneNumber: 18, characters: ['Luna', 'Rill', 'Navi'], imageUrl: 'https://getapib.org/frame.jpg', prompt: 'Rill raises a shell beside Luna.', action: 'Raise the shell.', description: 'Raise the shell.', status: 'completed', speech: [{ character: 'Rill', exactLine: 'Hear me.' }], videoUrl: 'https://example.test/old.mp4', videoTaskId: 'paid-old-task' };
const bad = { characters: [{ name: 'Luna', status: 'duplicated', evidence: 'Two matching mermaids' }, { name: 'Rill', status: 'missing', evidence: 'No eel in frame' }], unexpected: [] };
const good = { characters: [{ name: 'Luna', status: 'present', evidence: 'Blue-coated mermaid at left' }, { name: 'Rill', status: 'present', evidence: 'Gold-sashed eel at right' }], unexpected: [] };

test('visual checks reject missing and duplicated fictional roles regardless of an invented passed flag', () => {
  const check = parseImageCastCheck({ ...bad, passed: true }, board, cast);
  assert.equal(check.passed, false); assert.equal(check.issues.length, 2);
  assert.equal(parseImageCastCheck(good, board, cast).passed, true);
  assert.equal(parseImageCastCheck({ ...good, unexpected: ['another Luna'] }, board, cast).passed, false);
  assert.throws(() => parseImageCastCheck({ characters: [good.characters[0], good.characters[0]], unexpected: [] }, board, cast), /重复|不完整/);
  assert.deepEqual(visibleImageCast(board, cast).map(c => c.name), ['Luna', 'Rill']);
});

test('cached visual checks survive a retry without fetching images or buying another model call', async () => {
  let saved, calls = 0, images = 0;
  const draft = { read: async () => saved, save: async raw => { saved = raw; } };
  const deps = { draft, image: async url => { images++; return url; }, chat: async (prompt, options) => {
    calls++; assert.match(prompt, /fictional character/); assert.equal(options.imageUrls.length, 3); return JSON.stringify(bad);
  } };
  assert.equal((await auditImageCast(board, cast, { model: 'fixture' }, deps)).passed, false);
  assert.equal((await auditImageCast(board, cast, { model: 'fixture' }, deps)).passed, false);
  assert.equal(calls, 1); assert.equal(images, 3);
});

test('model transport failures never become passing visual checks', async () => {
  const result = await auditImageCast(board, cast, {}, { draft: { read: async () => undefined, save: async () => assert.fail('must not save transport failure as a model result') }, image: async url => url, chat: async () => { throw new Error('offline'); } });
  assert.equal(result.passed, null); assert.match(result.issues[0], /待复核/);
  assert.throws(() => prepareImageCastRepair(board, result, cast), /无需修复/);
});

test('identity repair preserves screenplay and remains bounded across restart', () => {
  const original = structuredClone(board), check = parseImageCastCheck(bad, board, cast);
  const repaired = prepareImageCastRepair(board, check, cast);
  assert.deepEqual(board, original); assert.deepEqual(repaired.speech, original.speech); assert.equal(repaired.prompt, original.prompt); assert.equal(repaired.action, original.action);
  assert.equal(repaired.imageUrl, undefined); assert.equal(repaired.imageCastRepairAttempts, 1);
  assert.match(repaired.imageCastRepairPrompt, /Never replace an animal/);
  const second = { ...repaired, imageUrl: 'https://getapib.org/second.jpg' };
  assert.throws(() => prepareImageCastRepair(second, check, cast), /过期/);
  const repairedAgain = prepareImageCastRepair(second, { ...check, imageUrl: second.imageUrl }, cast);
  assert.equal(repairedAgain.imageCastRepairAttempts, 2);
  assert.throws(() => prepareImageCastRepair({ ...repairedAgain, imageUrl: board.imageUrl }, check, cast), /两次自动补图/);
});

test('vision inputs retain all image evidence while text-only requests keep their existing shape', () => {
  assert.equal(chatInputContent('text'), 'text'); assert.equal(responsesInput('text'), 'text');
  const images = ['data:image/jpeg;base64,fixture-a', 'data:image/jpeg;base64,fixture-b'];
  assert.deepEqual(chatInputContent('inspect', images).slice(1).map(c => c.image_url.url), images);
  assert.deepEqual(responsesInput('inspect', images)[0].content.slice(1).map(c => c.image_url), images);
});

test('cast inspection refuses arbitrary hosts and local-network image URLs', async () => {
  for (const url of ['http://127.0.0.1/private', 'https://example.test/private', 'https://res.cloudinary.com:444/private', 'https://user:pass@res.cloudinary.com/private']) await assert.rejects(imageForCastAudit(url), /素材库/);
});

test('a reference-sheet pass cannot hide a missing creature in the actual frame', async () => {
  let calls = 0;
  const check = await auditImageCast(board, cast, {}, {
    draft: { read: async () => undefined, save: async () => {} }, image: async url => url,
    chat: async (prompt, options) => {
      calls++;
      assert.match(prompt, /Never infer human legs beneath clothing/);
      return JSON.stringify(options.imageUrls.length === 1 || prompt.includes('RESOLVE A DISAGREEMENT') ? bad : good);
    },
  });
  assert.equal(calls, 3); assert.equal(check.passed, false); assert.match(check.issues.join(' '), /No eel/);
});

test('a blind anatomy disagreement is checked against the approved design before buying a repair', async () => {
  const prompts = [];
  const check = await auditImageCast(board, cast, {}, {
    draft: { read: async () => undefined, save: async () => {} }, image: async url => url,
    chat: async (prompt, options) => {
      prompts.push(prompt);
      return JSON.stringify(options.imageUrls.length === 1 ? { ...good, characters: [good.characters[0], { name: 'Rill', status: 'wrong_identity', evidence: 'Eel head with upright torso and arms' }] } : good);
    },
  });
  assert.equal(prompts.length, 3);
  assert.match(prompts[2], /feature already present in the approved reference is not a new species error/);
  assert.equal(check.passed, true);
});

test('a failed disagreement review remains unknown, never a passing check', async () => {
  const check = await auditImageCast(board, cast, {}, {
    draft: { read: async () => undefined, save: async () => {} }, image: async url => url,
    chat: async (prompt, options) => {
      if (prompt.includes('RESOLVE A DISAGREEMENT')) throw new Error('offline');
      return JSON.stringify(options.imageUrls.length === 1 ? bad : good);
    },
  });
  assert.equal(check.passed, null);
  assert.match(check.issues.join(' '), /待复核/);
});

test('humanoid close-ups are judged against references without inventing absent tails', async () => {
  let calls = 0;
  const one = { ...board, characters: ['Luna'] };
  const check = await auditImageCast(one, cast, {}, {
    draft: { read: async () => undefined, save: async () => {} }, image: async url => url,
    chat: async (prompt, options) => {
      calls++;
      assert.equal(options.imageUrls.length, 2, 'the first reference pass must understand occlusion');
      assert.match(prompt, /Never infer human legs beneath clothing/);
      assert.match(prompt, /actually visible conflicting anatomy/);
      return JSON.stringify({ characters: [good.characters[0]], unexpected: ['none'] });
    },
  });
  assert.equal(calls, 1); assert.equal(check.passed, true);
});


test('MJ identity checks reject multi-panel output even when the actors match', () => {
  const single = { ...board, requireSingleFrame: true };
  assert.equal(parseImageCastCheck({ ...good, singleFrame: false }, single, cast).passed, false);
  assert.equal(parseImageCastCheck({ ...good, singleFrame: true }, single, cast).passed, true);
  assert.equal(parseImageCastCheck({ ...good, singleFrame: null }, single, cast).passed, null);
  assert.throws(() => parseImageCastCheck(good, single, cast), /singleFrame/);
});
