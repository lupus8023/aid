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
  const policy = await readFile(new URL('../lib/videoTextPolicy.ts', import.meta.url), 'utf8');
  assert.match(source, /subject_definitions:/);
  assert.match(source, /integrated_multimodal_description:/);
  assert.match(source, /NO_SUBTITLE_POLICY/);
  assert.match(policy, /纯净原片要求/);
  assert.match(policy, /逐字对白仅由声音承载/);
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
  assert.match(once, /纯净原片要求/);
  assert.match(once, /画面中不添加字幕、标题、对白文字、水印或界面/);
  assert.match(once, /只保留参考图中实物本来就有的印字/);
  assert.equal((once.match(/纯净原片要求/g) || []).length, 1);
});

test('image-to-video sends the text-free policy to both ComfyUI and remote providers', async () => {
  const source = await readFile(new URL('../app/api/image-to-video/route.ts', import.meta.url), 'utf8');
  assert.match(source, /const safePrompt = enforceNoSubtitles\(localizedPrompt\)/);
  assert.match(source, /h3VisualPromptIsChinese\(localizedPrompt\)/);
  assert.match(source, /prompt: safePrompt/);
  assert.match(source, /let enhancedPrompt = safePrompt/);
  assert.match(source, /createVideoTask\(\s*enhancedPrompt/s);
});

test('automatic production relies on the prompt instead of blocking on visual quality audits', async () => {
  const source = await readFile(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/api\/series\/audit-video-duplicates/);
  assert.doesNotMatch(source, /\/api\/series\/audit-images/);
  assert.doesNotMatch(source, /检查重复角色与烧录字幕|核验分镜角色与固定道具一致性/);
  assert.match(source, /planAutoVideoBatches\(videoGroups\)/);
  assert.match(source, /await Promise\.allSettled\(batch\.map\(completeVideoGroup\)\)/);
});
