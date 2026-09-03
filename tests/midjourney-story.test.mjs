import test from 'node:test';
import assert from 'node:assert/strict';
import { midjourneyShotInput } from '../lib/midjourneyStory.ts';
import { buildMidjourneyImaginePayload, midjourneyGenerationPath, midjourneyEditPayload } from '../lib/midjourney.ts';
import { planAutoImageBatch } from '../lib/autoProduction.ts';

const cast = ['Luna', 'Bram', 'Mira', 'Rill'].map(name => ({ name, description: `${name} has a distinct face and a weathered costume.`, imageUrl: `https://example.com/${name}.png` }));
const board = { id: 'shot-8', sceneNumber: 8, characters: ['Luna', 'Bram'], objects: [], prompt: 'Luna lays the folded note on the desk while Bram holds the door open.', action: 'Luna lowers the note.', shotSize: 'medium wide', angle: 'eye level', cameraMove: 'static', sceneStyle: 'Reef hall under cool daylight', characterCostume: { Luna: 'green scales and frayed cloak' } };

test('MJ queues missing individual shots even for empty or legacy grid batches, preserving completed images', () => {
  const group = Array.from({ length: 9 }, (_, i) => ({ ...board, id: `s${i}`, imageTaskMode: 'grid', taskId: 'paid-old-grid', ...(i === 2 ? { imageUrl: 'keep.png' } : {}) }));
  const plan = planAutoImageBatch(group, 'midjourney');
  assert.equal(plan.kind, 'generate-missing');
  assert.deepEqual(plan.storyboardIds, ['s0','s1','s3','s4','s5','s6','s7','s8']);
  assert.equal(group[2].imageUrl, 'keep.png');
  assert.equal(planAutoImageBatch(group, 'seedream-5-0-pro').kind, 'await-legacy-grid');
  assert.equal(planAutoImageBatch(group.slice(0, 4).map(s => ({ ...s, imageGridSize: 2 })), 'seedream-5-0-pro').kind, 'resume-grid');
  assert.equal(planAutoImageBatch(group.map(s => ({ ...s, imageUrl: 'keep.png' })), 'midjourney').kind, 'skip');
});

test('fixed cast references and identity mapping survive the actual MJ prompt compiler', () => {
  const input = midjourneyShotInput(board, cast, [], { Luna: 'https://example.com/locked-Luna.png' }, 'https://example.com/hall.png');
  assert.deepEqual(input.imageUrls, ['https://example.com/locked-Luna.png','https://example.com/Bram.png','https://example.com/hall.png']);
  const payload = buildMidjourneyImaginePayload({ ...input, aspectRatio: '1:1', taskMode: 'story-shot', visualStyle: 'cinematic-natural' });
  assert.match(payload.prompt, /Image 1: Character Luna/);
  assert.match(payload.prompt, /Image 2: Character Bram/);
  assert.match(payload.prompt, /green scales and frayed cloak/);
  assert.match(payload.prompt, /Exactly 2 distinct characters/);
  assert.ok(payload.prompt.includes(board.prompt));
  assert.match(payload.prompt, /no merged faces or duplicated actors/);
  assert.equal(payload.version, '8.2'); assert.equal(payload.size, '1:1');
  const next = midjourneyShotInput({ ...board, sceneNumber: 9, prompt: 'Luna walks away.' }, cast, [], { Luna: 'https://example.com/locked-Luna.png' }, 'https://example.com/hall.png');
  assert.deepEqual(next.imageUrls, input.imageUrls);
});

test('reference capacity reserves every actor before scenery and never silently discards a fifth actor', () => {
  const crowded = { ...board, characters: cast.map(c => c.name), objects: ['note'] };
  assert.deepEqual(midjourneyShotInput(crowded, cast, [{ name: 'note', description: 'folded paper', imageUrl: 'prop.png' }], {}, 'scene.png').imageUrls, cast.map(c => c.imageUrl));
  const fifth = { name: 'Fifth', imageUrl: 'fifth.png', description: 'A guard.' };
  assert.throws(() => midjourneyShotInput({ ...crowded, characters: [...crowded.characters, 'Fifth'] }, [...cast, fifth], [], {}), /最多4/);
});

test('reference-guided story shots use MJ edits while unreferenced generation remains Imagine', () => {
  assert.equal(midjourneyGenerationPath('story-shot', true), '/midjourney/generations/edits');
  assert.equal(midjourneyGenerationPath('story-shot', false), '/midjourney/generations');
  assert.equal(midjourneyGenerationPath('single', true), '/midjourney/generations');
  const imagine = buildMidjourneyImaginePayload({ prompt: 'A woman by the shore.', aspectRatio: '9:16', imageUrls: ['ref.png'], taskMode: 'story-shot', personalizationProfile: 'abc123' });
  const edit = midjourneyEditPayload(imagine);
  assert.deepEqual(edit.image_urls, ['ref.png']); assert.equal(edit.prompt, imagine.prompt);
  assert.equal(edit.version, '8.2'); assert.equal(edit.extra, '--profile abc123');
  assert.equal(edit.raw, true);
  for (const key of ['iw', 'quality', 'hd', 'stylize', 'chaos', 'negative_prompt']) assert.equal(edit[key], undefined);
});

test('photographic finishing does not force a nonhuman character into a human actor', () => {
  const creature = { name: 'Rill', description: 'A nonhuman eel with an eel head and continuous elongated body, no human torso.', imageUrl: 'eel.png' };
  const input = midjourneyShotInput({ ...board, characters: ['Rill'], prompt: 'Rill curves toward the scroll in his sash.' }, [creature], [], {});
  const payload = buildMidjourneyImaginePayload({ ...input, aspectRatio: '9:16', taskMode: 'story-shot', visualStyle: 'cinematic-natural' });
  assert.match(payload.prompt, /eel head and continuous elongated body/);
  assert.match(payload.prompt, /preserve each described species and anatomy/);
  assert.doesNotMatch(payload.prompt, /real human actor/);
});
