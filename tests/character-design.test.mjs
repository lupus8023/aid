import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCharacterBiblePrompt, buildCharacterConceptGridPrompt } from '../lib/promptArchitecture.ts';
import { buildCloudinaryGridCellUrls } from '../lib/gridCloudinary.ts';

test('builds four- and nine-direction character selection boards', () => {
  const four = buildCharacterConceptGridPrompt({
    name: 'Meme',
    role: 'Mermaid',
    age: 'Childlike',
    personality: 'curious, playful, gentle, brave',
    coreTheme: 'A fearless explorer with a kind heart',
    description: 'large brown curls, warm brown eyes, turquoise tail',
    costumeDesc: 'green shell pendant and green bandeau',
    candidateCount: 4,
    visualStyle: '3d-cinema',
  });
  const nine = buildCharacterConceptGridPrompt({
    name: 'Meme',
    description: 'large brown curls, warm brown eyes, turquoise tail',
    candidateCount: 9,
  });

  assert.match(four, /exactly 4 distinct candidates/i);
  assert.match(four, /2 by 2 grid/i);
  assert.match(nine, /exactly 9 distinct candidates/i);
  assert.match(nine, /3 by 3 grid/i);
  assert.match(four, /one character per cell/i);
});

test('carries locked character metadata into the final production bible', () => {
  const prompt = buildCharacterBiblePrompt({
    name: 'Meme',
    role: 'Mermaid',
    age: 'Childlike',
    personality: 'curious, playful, gentle, brave',
    coreTheme: 'A fearless explorer with a kind heart',
    description: 'large brown curls, warm brown eyes, turquoise tail',
    costumeDesc: 'green shell pendant and green bandeau',
    hasIdentityReference: true,
    visualStyle: '3d-cinema',
  });

  assert.match(prompt, /Role \/ identity: Mermaid/);
  assert.match(prompt, /Approximate age: Childlike/);
  assert.match(prompt, /Personality keywords: curious, playful, gentle, brave/);
  assert.match(prompt, /Silhouette lock/);
  assert.match(prompt, /Expression system: 8/);
  assert.match(prompt, /Continuity palette/);
});

test('splits concept contact sheets according to the selected grid size', () => {
  const source = 'https://res.cloudinary.com/demo/image/upload/v1/character-grid.jpg';
  const four = buildCloudinaryGridCellUrls(source, 2048, 2048, 2);
  const nine = buildCloudinaryGridCellUrls(source, 3072, 3072, 3);
  assert.equal(four.length, 4);
  assert.equal(nine.length, 9);
  assert.notEqual(four[0], four[1]);
  assert.notEqual(nine[0], nine[8]);
});
