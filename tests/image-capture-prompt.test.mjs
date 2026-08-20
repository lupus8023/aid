import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGridPrompt } from '../lib/gridSplitter.ts';
import {
  buildCompactImageCaptureContract,
  buildImageCaptureContract,
} from '../lib/promptArchitecture.ts';

test('still capture contract models optical cause and effect instead of generic style words', () => {
  const contract = buildImageCaptureContract('cinematic-natural');

  assert.match(contract, /camera-to-subject distance/i);
  assert.match(contract, /focus plane/i);
  assert.match(contract, /motivated key\/practical light/i);
  assert.match(contract, /highlight roll-off/i);
  assert.match(contract, /material-specific diffuse\/specular response/i);
  assert.match(contract, /Do not stack random lens defects/i);
});

test('compact capture contract keeps the essential grid optics within a small budget', () => {
  const contract = buildCompactImageCaptureContract('cinematic-natural');

  assert.ok(contract.length < 700, `compact contract was ${contract.length} characters`);
  assert.match(contract, /camera height\/distance/i);
  assert.match(contract, /near\/mid\/far falloff/i);
  assert.match(contract, /motivated light angle\/falloff/i);
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

  assert.ok(prompt.length <= 3500, `grid prompt was ${prompt.length} characters`);
  assert.match(prompt, /GRID CAPTURE PHYSICS/);
  assert.match(prompt, /Panel 9 \(story scene 9\): UNIQUE_OPTICS_9/);
  for (let index = 1; index <= 9; index += 1) {
    assert.match(prompt, new RegExp(`UNIQUE_OPTICS_${index}`));
  }
});
