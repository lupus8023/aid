import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCapturePreset,
  buildDirectorCaptureContract,
  buildGridCapturePresetContract,
  buildImageCapturePresetContract,
  buildVideoCapturePresetContract,
  isObservationalCapturePreset,
  normalizeCapturePreset,
} from '../lib/capturePresets.ts';
import { buildGridPrompt } from '../lib/gridSplitter.ts';
import { buildStoryWorldAnchorPrompt } from '../lib/promptArchitecture.ts';
import { buildVideoSegmentPrompt, sanitizeVisualDirection } from '../lib/videoGenerator.ts';
import { videoSegmentGenerationSignature } from '../lib/videoSegments.ts';

const storyboard = (capturePreset = 'cinematic-narrative') => ({
  id: 'nana-1', sceneNumber: 1,
  description: 'Nana walks past a Shanghai street shop and glances at a display.',
  action: 'Nana walks past a Shanghai street shop and glances at a display.',
  prompt: 'Nana walks through a busy Shanghai shopping street.',
  characters: ['Nana'], objects: [], status: 'completed', imageUrl: 'https://example.com/nana.jpg',
  videoStatus: 'completed', videoUrl: 'https://example.com/nana.mp4', videoDuration: 8,
  visualStyle: 'cinematic-natural', capturePreset,
  audioPlan: { backgroundHuman: 'none', environment: ['Shanghai street ambience'], foley: ['footsteps'], music: 'none', silenceBefore: 0, silenceAfter: 0 },
});

test('unknown capture modes safely migrate to the project default', () => {
  assert.equal(normalizeCapturePreset('broadcast-candid'), 'broadcast-candid');
  assert.equal(normalizeCapturePreset('made-up-mode'), 'cinematic-narrative');
});

test('broadcast candid contract retains the useful physical capture cues', () => {
  const image = buildImageCapturePresetContract('broadcast-candid');
  const grid = buildGridCapturePresetContract('broadcast-candid');
  const director = buildDirectorCaptureContract('broadcast-candid');
  for (const value of [image, grid]) {
    assert.match(value, /long-lens/i);
    assert.match(value, /foreground.*occlusion/i);
    assert.match(value, /off-center/i);
    assert.match(value, /motion blur/i);
    assert.match(value, /broadcast compression/i);
    assert.match(value, /no influencer|No influencer/i);
  }
  assert.match(director, /电视直播长焦抓拍/);
  assert.match(director, /前景行人或物体遮挡/);
});

test('observational capture contracts separate subject behavior from delayed camera response', () => {
  const director = buildDirectorCaptureContract('broadcast-candid');
  const image = buildImageCapturePresetContract('broadcast-candid');
  const video = buildVideoCapturePresetContract('broadcast-candid');
  assert.match(director, /人物动后才.*修正构图或恢复焦点/);
  assert.match(director, /原本在做事.*触发.*眼球先移动.*回到原任务/);
  assert.match(image, /one unguarded instant/i);
  assert.match(image, /gesture caught slightly incomplete/i);
  assert.match(video, /never anticipates action/i);
  assert.match(video, /reacts a beat late/i);
  assert.match(video, /brief low-activity intervals/i);
  assert.equal(isObservationalCapturePreset('broadcast-candid'), true);
  assert.equal(isObservationalCapturePreset('commercial-studio'), false);
});

test('MJ world master and Nano grid both receive the project capture mode', () => {
  const master = buildStoryWorldAnchorPrompt({
    sceneStyle: 'a busy Shanghai shopping street in late afternoon',
    representativeShot: 'Nana pauses beside a street-facing shop window',
    characterNames: ['Nana'], visualStyle: 'cinematic-natural', capturePreset: 'broadcast-candid', aspectRatio: '16:9',
  });
  assert.match(master, /CAPTURE MODE \(authoritative\): Authentic live-television candid capture/i);

  const grid = buildGridPrompt('Shanghai shopping street', 'Nana identity', Array(9).fill('Nana browses a shop window'), '16:9', ['Nana'], undefined, 'cinematic-natural', 'broadcast-candid');
  assert.match(grid, /CAPTURE MODE FOR EVERY PANEL/);
  assert.match(grid, /live-TV candid coverage/i);
});

test('the final H3 prompt receives visual-only broadcast candid direction', () => {
  const prompt = buildVideoSegmentPrompt([storyboard('broadcast-candid')], [], { duration: 8, language: 'zh' });
  assert.match(prompt, /CAPTURE MODE: Authentic live television candid footage/);
  assert.match(prompt, /long-lens observational viewpoint/i);
  assert.match(prompt, /foreground pedestrians or street objects briefly occluding the frame/i);
  assert.match(prompt, /continue the low-intensity task in/i);
  assert.match(prompt, /one adjustment may pause unfinished/i);
  assert.match(prompt, /return attention(?: to the task)?/i);
  assert.doesNotMatch(prompt, /<d>/);
});

test('pseudo-speech imagery is removed before a silent H3 prompt is compiled', () => {
  const cleaned = sanitizeVisualDirection('她低头整理袖口。嘴唇微张，像很轻地自言自语了半句话。随后她抬眼。');
  assert.match(cleaned, /整理袖口/);
  assert.match(cleaned, /抬眼/);
  assert.doesNotMatch(cleaned, /自言自语|半句话|嘴唇微张/);

  const silent = {
    ...storyboard('broadcast-candid'),
    action: '她低头整理袖口。嘴唇微张，像很轻地自言自语了半句话。',
    description: '她低头整理袖口。嘴唇微张，像很轻地自言自语了半句话。',
  };
  const prompt = buildVideoSegmentPrompt([silent], [], { duration: 8, language: 'zh' });
  assert.doesNotMatch(prompt, /自言自语|半句话|as if .*speaking|mouths? .*word/i);
  assert.doesNotMatch(prompt, /<d>/);
});

test('changing capture mode invalidates both visual results and the H3 cache signature', () => {
  const prior = storyboard('cinematic-narrative');
  const next = applyCapturePreset(prior, 'broadcast-candid');
  assert.equal(next.capturePreset, 'broadcast-candid');
  assert.equal(next.imageUrl, undefined);
  assert.equal(next.videoUrl, undefined);
  assert.equal(next.status, 'pending');
  assert.equal(next.videoStatus, 'pending');
  assert.notEqual(videoSegmentGenerationSignature([prior]), videoSegmentGenerationSignature([{ ...prior, capturePreset: 'broadcast-candid' }]));
});
