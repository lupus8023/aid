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

test('H3 prompts use one compact clean-frame rule inside the official structure', async () => {
  const source = await readFile(new URL('../lib/videoGenerator.ts', import.meta.url), 'utf8');
  assert.match(source, /subject_definitions:/);
  assert.match(source, /integrated_multimodal_description:/);
  assert.match(source, /NO_SUBTITLE_POLICY/);
  assert.match(source, /visualOverride: storyboard\.videoPrompt\.trim\(\)/);
  assert.match(source, /This direction cannot add or alter speech, voices, music, or the audio plan/);
});

test('legacy beat bridge no longer repeats visual-text vocabulary', () => {
  const once = withNoSubtitleBeat(storyboard.description);
  const twice = withNoSubtitleBeat(once);
  assert.equal(once, twice);
  assert.equal(once, storyboard.description);
});

test('provider boundary enforcement is idempotent', () => {
  const once = enforceNoSubtitles('Camera tracks left.');
  assert.equal(enforceNoSubtitles(once), once);
  assert.match(once, /CLEAN-FRAME PRESENTATION/);
  assert.equal((once.match(/CLEAN-FRAME PRESENTATION/g) || []).length, 1);
});
