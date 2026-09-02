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

test('H3 prompts use natural-language text-free direction inside the official structure', async () => {
  const source = await readFile(new URL('../lib/videoGenerator.ts', import.meta.url), 'utf8');
  assert.match(source, /subject_definitions:/);
  assert.match(source, /integrated_multimodal_description:/);
  assert.match(source, /The photographic frame remains clean and text-free/);
  assert.doesNotMatch(source, /画面里不要出现字幕、文字、标志、水印或界面/);
  assert.doesNotMatch(source, /timeline_json|aid_h3_timeline|frame_text_policy/);
  assert.match(source, /visualOverride: storyboard\.videoPrompt\.trim\(\)/);
  assert.match(source, /sanitizeVisualDirection\(options\.visualOverride/);
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
  assert.match(once, /Do not render subtitles, captions, titles, speech bubbles, logos, watermarks, UI, or any readable characters/);
  assert.equal((once.match(/CLEAN-FRAME PRESENTATION/g) || []).length, 1);
});

test('image-to-video sends the text-free policy to both ComfyUI and remote providers', async () => {
  const source = await readFile(new URL('../app/api/image-to-video/route.ts', import.meta.url), 'utf8');
  assert.match(source, /const safePrompt = enforceNoSubtitles\(prompt\)/);
  assert.match(source, /prompt: safePrompt/);
  assert.match(source, /let enhancedPrompt = safePrompt/);
  assert.match(source, /createVideoTask\(\s*enhancedPrompt/s);
});

test('automatic ComfyUI production audits subtitles even when a shot has no characters', async () => {
  const source = await readFile(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  const auditSource = await readFile(new URL('../app/api/series/audit-video-duplicates/route.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(videoProvider === 'comfyui'\) \{/);
  assert.doesNotMatch(source, /videoProvider === 'comfyui' && group\.some\(item => item\.characters\.length\)/);
  assert.match(source, /检查重复角色与烧录字幕/);
  assert.match(auditSource, /readableText: parsed\.readableText/);
  assert.match(auditSource, /readableText: f\.readableText/);
});
