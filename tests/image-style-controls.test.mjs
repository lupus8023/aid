import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { PRODUCTION_STYLE_PRESETS } from '../lib/promptArchitecture.ts';
import { CAPTURE_PRESETS } from '../lib/capturePresets.ts';
import { buildImageStyleControls } from '../lib/imageStyleControls.ts';
import { buildCharacterMasterPrompt, buildGptCharacterMasterPrompt } from '../lib/characterVisualMaster.ts';
import { createStoryImageRequestPreparer } from '../lib/storyImageRequest.ts';
import { generateStoryboardImage } from '../lib/imageGenerator.ts';
import { buildGridPrompt } from '../lib/gridSplitter.ts';
import { POST as characterDesign } from '../app/api/character-design/route.ts';

const master = 'https://example.com/master.png', styleUrl = 'https://example.com/style.png';
const character = { id: 'c1', name: 'Qing', description: 'ivory robe and gold floral pin', imageUrl: master, visualMaster: { version: 1, imageUrl: master, source: 'midjourney' } };
const styleReference = { imageUrl: styleUrl, description: 'STYLE_SENTINEL: cool silver tones with violet shadows.' };
const shot = { id: 's1', sceneNumber: 1, status: 'pending', prompt: 'ACTION_SENTINEL: Qing lifts a curtain with two fingers.', characters: ['Qing'], objects: [] };

test('all 9 styles × 9 capture selections have concrete independent image instructions', () => {
  const unique = new Set();
  for (const style of PRODUCTION_STYLE_PRESETS) for (const capture of CAPTURE_PRESETS) {
    const options = { visualStyle: style.value, capturePreset: capture.value, hasCharacterReference: true };
    const prompt = buildImageStyleControls(options); unique.add(prompt);
    if (style.value !== 'follow-reference') assert.ok(prompt.includes(style.imageContract));
    if (capture.value !== 'follow-reference') assert.ok(prompt.includes(capture.image));
    assert.match(prompt, /preserve the referenced face identity/);
    for (const build of [buildCharacterMasterPrompt, buildGptCharacterMasterPrompt]) {
      const result = build({ name: 'Qing', description: 'CHARACTER_SENTINEL', ...options });
      if (style.value !== 'follow-reference') assert.ok(result.includes(style.imageContract));
      if (capture.value !== 'follow-reference') assert.ok(result.includes(capture.image));
    }
  }
  assert.equal(unique.size, 81);
  const inherited = buildImageStyleControls({ visualStyle: 'follow-reference', capturePreset: 'follow-reference', hasCharacterReference: true });
  assert.doesNotMatch(inherited, /SELECTED IMAGE STYLE|SELECTED CAPTURE METHOD|no beauty filter|surveillance/);
});

test('role endpoint sends sref and sw separately; GPT maps style as a separate image with description', async () => {
  const original = axios.post; const sent = [];
  axios.post = async (url, body) => { sent.push({ url, body }); return { data: { task_id: 'mj-style-unit', data: [{ task_id: 'gpt-style-unit' }] } }; };
  try {
    for (const model of ['midjourney', 'gpt-image-2']) {
      const response = await characterDesign(new Request('http://localhost/api/character-design', { method: 'POST', body: JSON.stringify({ stage: 'concepts', name: 'Qing', description: 'CHARACTER_SENTINEL', imageModel: model, apiKey: 'test', referenceImages: [master], visualStyle: 'anime', capturePreset: 'commercial-studio', styleReference, midjourneyProfile: '', midjourneyStyle: { styleWeight: 0 } }) }));
      assert.equal(response.status, 200);
      const result = await response.json(); assert.match(result.prompt, /STYLE_SENTINEL/);
      const body = sent.at(-1).body;
      assert.match(body.prompt, /SELECTED IMAGE STYLE: anime/);
      assert.match(body.prompt, /SELECTED CAPTURE METHOD: commercial-studio/);
      assert.match(body.prompt, /STYLE_SENTINEL/);
      if (model === 'midjourney') { assert.equal(body.sref, styleUrl); assert.equal(body.sw, 0); assert.deepEqual(body.image_urls, [master]); }
      else { assert.deepEqual(body.image_urls, [master, styleUrl]); assert.match(body.prompt, /Reference image 2 is STYLE ONLY/); assert.equal(body.sref, undefined); }
    }
  } finally { axios.post = original; }
});

test('Story keeps style through serialization and final single/grid payload without stealing an identity slot', async () => {
  const prepare = createStoryImageRequestPreparer(async () => { throw new Error('remote references need no upload'); });
  const original = axios.post; const sent = [];
  axios.post = async (url, body) => { sent.push(body); return { data: { data: [{ task_id: 'style-grid-unit' }] } }; };
  try {
    for (const grid of [false, true]) {
      const labels = ['CHARACTER IDENTITY: Qing'];
      const prompt = grid ? buildGridPrompt('palace', character.description, Array(4).fill(shot.prompt), '9:16', labels, [1,2,3,4], 'follow-reference', 'surveillance', 'gpt-image-2') : shot.prompt;
      const input = JSON.parse(await prepare({ storyboard: { ...shot, prompt }, characters: [character], objects: [], apiKey: 'test', imageModel: 'midjourney', aspectRatio: '9:16', visualStyle: 'follow-reference', capturePreset: 'surveillance', styleReference, ...(grid ? { referenceImages: [master], referenceImageLabels: labels } : {}) }));
      assert.equal(input.imageModel, 'gpt-image-2'); assert.deepEqual(input.styleReference, styleReference);
      await generateStoryboardImage(input.storyboard, input.characters, 'test', [], '9:16', input.imageModel, {}, undefined, input.referenceImages, input.referenceImageLabels, input.visualStyle, input.capturePreset, {}, '', {}, input.styleReference);
      const body = sent.at(-1);
      assert.deepEqual(body.image_urls, [master, styleUrl]);
      assert.match(body.prompt, /SELECTED CAPTURE METHOD: surveillance/);
      assert.match(body.prompt, /STYLE_SENTINEL/); assert.match(body.prompt, /ACTION_SENTINEL/);
      assert.doesNotMatch(body.prompt, /do not beautify, neutralize or restyle it/);
      if (grid) assert.equal((body.prompt.match(/SELECTED CAPTURE METHOD: surveillance/g) || []).length, 1);
    }
  } finally { axios.post = original; }
});
