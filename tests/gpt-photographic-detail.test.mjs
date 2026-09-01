import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGptImage2StoryPrompt } from '../lib/gptImagePrompt.ts';
import { buildGptCharacterAnchorPrompt, buildGptCharacterBiblePrompt, buildGptCharacterConceptPrompt, buildGptSceneReferencePrompt } from '../lib/gptImageReferences.ts';
import { buildStudioImagePrompt } from '../lib/imageCreation.ts';

const scene = {
  goal: 'An elderly mermaid in her unchanged green coat studies a sealed letter; she looks down.',
  sceneStyle: 'A rainy veranda at blue dawn, lit only by the overcast sky.',
  shotSize: 'medium close-up', angle: 'eye level, 65mm',
  exactCast: 'EXACT CAST (1 total): Mira, with her established fish tail.',
  characterCount: 1, visualStyle: 'cinematic-natural',
};

test('photography preserves authored detail without turning it into a rendering specification', () => {
  const prompt = buildGptImage2StoryPrompt(scene);
  for (const value of [scene.goal, scene.sceneStyle, scene.angle, scene.exactCast]) assert.ok(prompt.includes(value));
  assert.match(prompt, /Use the light already present/);
  assert.match(prompt, /do not invent freckles, scars/i);
  assert.match(prompt, /Every named human or humanlike cast member is an adult over 21; retain the specified age and identity/);
  assert.match(prompt, /超强真实感，像真实电影现场拍到的一瞬间/);
  assert.match(prompt, /Merfolk keep their fish tails, never human legs or shoes/);
  assert.doesNotMatch(prompt, /radial iris fibers|subsurface scattering|microcontrast|highlight roll-off|material response|real adult actors|22.year|94.58.92|Fuji Classic Chrome|masterpiece|museum-quality|Award-winning/);
  assert.ok(prompt.startsWith('SHOT:\n'+scene.goal));
  assert.ok(prompt.length < 2200);
  assert.doesNotMatch(prompt, /immutable design source|component layout/);
});

test('wide views and low-resolution capture do not acquire macro portrait treatment', () => {
  for (const shotSize of ['medium wide', 'extreme long shot', '全身远景']) {
    const prompt = buildGptImage2StoryPrompt({ ...scene, shotSize });
    assert.doesNotMatch(prompt, /radial iris fibers|fine vellus hair/);
    assert.match(prompt, /do not enlarge pores/);
  }
  for (const capturePreset of ['phone-bystander', 'surveillance', 'home-video']) {
    const prompt = buildGptImage2StoryPrompt({ ...scene, capturePreset });
    assert.doesNotMatch(prompt, /radial iris fibers|85mm|photochemical 35mm/);
    assert.match(prompt, /declared capture device/);
  }
});

test('empty shots and location references do not request facial rendering', () => {
  const prompt = buildGptImage2StoryPrompt({ ...scene, goal: 'An empty stone archway.', characterCount: 0, exactCast: 'EXACT CAST (0 total): no people.' });
  const scout = buildGptSceneReferencePrompt('An empty stone archway in moonlight', 'cinematic-natural', '1:1');
  for (const value of [prompt, scout]) {
    assert.doesNotMatch(value, /radial iris|vellus hair|visible pores|lips retain/);
    assert.match(value, /Use the light already present/);
  }
  assert.match(scout, /moonlight/);
  assert.match(scout, /1:1 composition/);
});

test('character anchor and sheets retain their different layouts without macro or CG jargon', () => {
  const input = { name: 'Mira', description: 'An elderly mermaid', visualStyle: 'cinematic-natural', hasIdentityReference: true };
  const anchor = buildGptCharacterAnchorPrompt(input);
  const card = buildGptCharacterBiblePrompt(input);
  const casting = buildGptCharacterConceptPrompt({ ...input, candidateCount: 4, hasReferences: true });
  assert.match(anchor, /live-action wardrobe fitting/);
  assert.match(anchor, /Natural skin and hair/);
  assert.doesNotMatch(anchor, /radial iris|microcontrast|highlight roll-off|material response/);
  assert.match(card, /Apply separately at each view/);
  assert.match(card, /Four supporting full-body/);
  assert.doesNotMatch(casting, /radial iris fibers|fine vellus hair/);
  for (const value of [anchor, card, casting]) {
    assert.match(value, /never human legs or shoes/);
    assert.doesNotMatch(value, /radial iris fibers|subsurface scattering|microcontrast|highlight roll-off|material response/);
  }
});

test('nonphotographic media bypass photographic surface treatment', () => {
  for (const visualStyle of ['anime', '3d-cg', 'stop-motion']) {
    const story = buildGptImage2StoryPrompt({ ...scene, visualStyle });
    const creative = buildStudioImagePrompt({ model: 'gpt-image-2', visualStyle, usesReferenceImages: true, userIntent: 'An empty courtyard' });
    for (const value of [story, creative]) {
      assert.doesNotMatch(value, /PHOTOGRAPHIC SURFACE AND OPTICS|radial iris fibers/);
      assert.match(value, /OUTPUT MEDIUM/);
    }
  }
});

test('GPT creative photography respects authored location lighting while other model prompts remain unchanged', () => {
  const input = { usesReferenceImages: true, userIntent: 'An outdoor portrait in cool diffuse dawn light, 135mm lens.', scaleNotes: 'Keep the small bag 15cm wide.' };
  const gpt = buildStudioImagePrompt({ ...input, model: 'gpt-image-2' });
  assert.ok(gpt.includes(input.userIntent));
  assert.ok(gpt.includes(input.scaleNotes));
  assert.match(gpt, /immutable design source/);
  assert.match(gpt, /requested medium, setting, composition, lens, lighting/);
  assert.doesNotMatch(gpt, /STUDIO PHOTOGRAPHY QUALITY|controlled softbox lighting|50mm or 85mm lens look/);
  for (const model of ['midjourney', 'seedream-5-0-pro', 'comfyui-z-image-turbo']) {
    assert.equal(buildStudioImagePrompt({ ...input, model }), buildStudioImagePrompt(input));
  }
});
