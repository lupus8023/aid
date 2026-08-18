import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  enforceNoSubtitles,
  withNoSubtitleBeat,
} from '../lib/videoTextPolicy.ts';

const storyboard = {
  id: 'shot-1',
  sceneNumber: 1,
  description: 'A performer turns toward the window and speaks.',
  characters: ['A'],
  objects: [],
  dialogueLines: [{ character: 'A', text: '我们走吧。' }],
  dialogue: {},
  videoDuration: 5,
  visualStyle: 'cinematic-natural',
};

test('final and edited video prompts both use provider-boundary enforcement', async () => {
  const source = await readFile(new URL('../lib/videoGenerator.ts', import.meta.url), 'utf8');
  assert.match(source, /return enforceNoSubtitles\(`GOAL:/);
  assert.match(source, /return enforceNoSubtitles\(`\$\{storyboard\.videoPrompt\.trim\(\)\}/);
});

test('legacy Companion beat bridge is idempotent', () => {
  const once = withNoSubtitleBeat(storyboard.description);
  const twice = withNoSubtitleBeat(once);
  assert.equal(once, twice);
  assert.match(once, /台词只能存在于音轨/);
});

test('provider boundary enforcement is idempotent', () => {
  const once = enforceNoSubtitles('Camera tracks left.');
  assert.equal(enforceNoSubtitles(once), once);
  assert.match(once, /^ZERO-SUBTITLE OUTPUT CONTRACT/);
  assert.match(once, /FINAL VISUAL CHECK — ZERO-SUBTITLE OUTPUT CONTRACT/);
});
