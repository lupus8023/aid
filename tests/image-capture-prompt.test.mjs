import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGridPrompt } from '../lib/gridSplitter.ts';
import {
  buildCompactImageCaptureContract,
  buildImageCaptureContract,
  buildSceneReferencePrompt,
  buildStoryWorldAnchorPrompt,
} from '../lib/promptArchitecture.ts';

test('still capture contract models optical cause and effect instead of generic style words', () => {
  const contract = buildImageCaptureContract('cinematic-natural');

  assert.match(contract, /camera-to-subject distance/i);
  assert.match(contract, /focus plane/i);
  assert.match(contract, /motivated key or practical light/i);
  assert.match(contract, /highlight roll-off/i);
  assert.match(contract, /material-specific diffuse\/specular or stylized surface response/i);
  assert.match(contract, /Do not stack random lens defects/i);
});

test('compact capture contract gives grids a concrete style, light, lens and texture bible', () => {
  const contract = buildCompactImageCaptureContract('cinematic-natural');

  assert.ok(contract.length < 1000, `compact contract was ${contract.length} characters`);
  assert.match(contract, /MEDIUM\/TEXTURE/i);
  assert.match(contract, /LIGHT:/i);
  assert.match(contract, /LENS\/DEPTH:/i);
  assert.match(contract, /COLOR:/i);
  assert.match(contract, /unretouched pores/i);
  assert.match(contract, /motivated light falloff/i);
});

test('grid image styles are materially distinct instead of generic style labels', () => {
  const natural = buildCompactImageCaptureContract('cinematic-natural');
  const film = buildCompactImageCaptureContract('warm-film');
  const anime = buildCompactImageCaptureContract('anime');
  const stopMotion = buildCompactImageCaptureContract('stop-motion');

  assert.match(film, /photochemical/i);
  assert.match(anime, /line-weight hierarchy/i);
  assert.match(stopMotion, /fingerprints/i);
  assert.notEqual(natural, film);
  assert.notEqual(film, anime);
  assert.notEqual(anime, stopMotion);
});

test('full GPT Image reference contracts use medium-specific physics for non-photographic styles', () => {
  const anime = buildImageCaptureContract('anime');
  const cg = buildImageCaptureContract('3d-cg');
  const stopMotion = buildImageCaptureContract('stop-motion');

  assert.match(anime, /line-weight hierarchy|cel-shadow groups/i);
  assert.match(anime, /exclude photographic skin|3D material drift/i);
  assert.match(cg, /stable topology|physically based/i);
  assert.match(cg, /unified global illumination|physical virtual-camera/i);
  assert.match(stopMotion, /clay, fabric, paper|fingerprints/i);
  assert.match(stopMotion, /tabletop light|miniature contact shadows/i);
  assert.notEqual(anime, cg);
  assert.notEqual(cg, stopMotion);
});

test('scene reference prompt states the visual goal before style and capture constraints', () => {
  const prompt = buildSceneReferencePrompt('a compact skin-care laboratory with one west window', 'commercial', '16:9');
  assert.ok(prompt.indexOf('Create a professional') < prompt.indexOf('PRODUCTION STYLE BIBLE'));
  assert.ok(prompt.indexOf('PRODUCTION STYLE BIBLE') < prompt.indexOf('STILL IMAGE SPECIFICATION'));
  assert.match(prompt, /precise surface response|specular/i);
  assert.match(prompt, /no captions, labels, logos, watermark, or readable text/i);
});

test('Midjourney story master stays environmental instead of becoming another costume portrait', () => {
  const prompt = buildStoryWorldAnchorPrompt({
    sceneStyle: 'an underwater palace meadow',
    representativeShot: 'Lanxi lifts a shell into rippled sunlight',
    characterNames: ['Lanxi'],
    visualStyle: 'cinematic-natural',
    aspectRatio: '16:9',
  });
  assert.match(prompt, /wide environmental master shot/i);
  assert.match(prompt, /20–35% of frame height/i);
  assert.match(prompt, /no close-up, studio portrait/i);
  assert.match(prompt, /not a portrait, character sheet/i);
});

test('storyboard image assembly assigns one explicit job to each GPT Image reference', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../lib/imageGenerator.ts', import.meta.url), 'utf8'));
  assert.match(source, /IMAGE GOAL:/);
  assert.match(source, /REFERENCE JOBS — each input has one job only/);
  assert.match(source, /CHARACTER IDENTITY ONLY/);
  assert.match(source, /ENVIRONMENT ONLY/);
  assert.match(source, /OBJECT IDENTITY ONLY/);
  assert.match(source, /Change only the action, composition, and viewpoint requested in IMAGE GOAL/);
});

test('grid prompts preserve structural line breaks at the provider boundary', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../lib/imageGenerator.ts', import.meta.url), 'utf8'));
  assert.match(source, /replace\(\/\\r\\n\?\/g, '\\n'\)/);
  assert.doesNotMatch(source, /replace\(\/\[\\x00-\\x1F\\x7F\]\/g, ''\)/);
});

test('grid prompt preserves all nine unique shot identities under the provider budget', () => {
  const shots = Array.from({ length: 9 }, (_, index) => (
    `UNIQUE_OPTICS_${index + 1}: subject action; camera ${index + 1}m away at a distinct height; asymmetric foreground occlusion; eyes on the focus plane; side light incidence ${index + 1}; finite highlight roll-off. CAST[1]: HERO; each exactly once.`
  ));
  const prompt = buildGridPrompt(
    'One west-facing window is the motivated key; dark wood supplies warm bounce; negative fill on camera-right.',
    'HERO: weathered linen coat, natural skin texture, unchanged identity',
    shots,
    '16:9',
    ['HERO character identity reference'],
    Array.from({ length: 9 }, (_, index) => index + 1),
    'cinematic-natural',
  );
  assert.doesNotMatch(prompt, /Panel\s+1\s*\(/i);
  assert.match(prompt, /invisible directing notes/i);
  assert.match(prompt, /ZERO TYPOGRAPHY/i);

  assert.ok(prompt.length <= 3500, `grid prompt was ${prompt.length} characters`);
  assert.match(prompt, /GRID STYLE BIBLE/);
  assert.match(prompt, /bottom-right frame, depict UNIQUE_OPTICS_9/i);
  for (let index = 1; index <= 9; index += 1) {
    assert.match(prompt, new RegExp(`UNIQUE_OPTICS_${index}`));
  }
});
