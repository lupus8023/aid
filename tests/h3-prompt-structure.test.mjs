import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';
import { buildVideoStyleContract, PRODUCTION_STYLE_PRESETS } from '../lib/promptArchitecture.ts';

const shot = (sceneNumber, extra = {}) => ({
  id: `shot-${sceneNumber}`,
  sceneNumber,
  description: `The protagonist crosses zone ${sceneNumber}, notices a concrete clue, changes direction and reaches a visibly different final pose.`,
  prompt: '',
  characters: ['Lin'],
  objects: ['red envelope'],
  imageUrl: `https://example.com/${sceneNumber}.jpg`,
  status: 'completed',
  durationHint: 3,
  visualStyle: 'cinematic-natural',
  ...extra,
});

test('writes multi-reference H3 prompts in the official six-section order', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1),
    shot(2, { dialogueLines: [{ character: 'Lin', text: '线索就在这里。' }] }),
    shot(3),
    shot(4),
  ], [], { duration: 15, referenceAudioNames: ['Lin'] });

  const fields = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:'];
  let cursor = -1;
  fields.forEach(field => {
    const next = prompt.indexOf(field);
    assert.ok(next > cursor, `${field} is missing or out of order`);
    cursor = next;
  });
  assert.match(prompt, /<d>\[Chinese\] 线索就在这里。<\/d>/);
  assert.equal((prompt.match(/线索就在这里。/g) || []).length, 1);
  assert.match(prompt, /alone speaks once/);
  assert.match(prompt, /tagged dialogue in the shot timeline is exhaustive/);
  assert.match(prompt, /No background or unlisted person produces any voice/);
  assert.match(prompt, /no added, repeated, paraphrased, overlapping, or reassigned speech/);
  assert.match(prompt, /camera .* with small amplitude at moderate speed/i);
  assert.equal((prompt.match(/CLEAN-FRAME PRESENTATION/g) || []).length, 1);
  assert.ok(prompt.length <= 7000, `prompt exceeds H3's 7000-character limit: ${prompt.length}`);
});

test('keeps silent clips free of all human vocalization and cannot be bypassed by a prompt override', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { characters: ['Lin', 'Mei'] }),
  ], [], {
    duration: 6,
    visualOverride: 'Camera pushes in.\noverall_soundscape: Mei whispers a new line.\n<d>[Chinese] 临时加一句</d>',
  });
  assert.match(prompt, /user-specified visual action and camera direction is: Camera pushes in/);
  assert.doesNotMatch(prompt, /临时加一句|Mei whispers/);
  assert.match(prompt, /No person speaks or produces human vocal sound/);
  assert.match(prompt, /No human vocalization occurs anywhere in the clip/);
  assert.match(prompt, /No background or unlisted person produces any voice/);
});

test('locks H3 speech to the project language and rejects mismatched generated dialogue', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { dialogueLines: [{ character: 'Lin', text: 'The answer is already here.' }] }),
  ], [], { duration: 7, language: 'en' });
  assert.match(prompt, /<d>\[English\] The answer is already here\.<\/d>/);
  assert.match(prompt, /Spoken-language lock: the project dialogue language is English/);
  assert.match(prompt, /Never translate, localize, replace, or add dialogue/);

  assert.throws(() => buildVideoSegmentPrompt([
    shot(2, { dialogueLines: [{ character: 'Lin', text: '答案就在这里。' }] }),
  ], [], { duration: 7, language: 'en' }), /项目对白语言为 English/);
});

test('binds multiple sequential dialogue lines to their matching H3 voice references', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S01', character: 'Lin', exactLine: '你看见了吗？', emotion: 'alert', delivery: 'quietly', volume: 'soft', lipSync: true, source: 'story_required' }] }),
    shot(2, { characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S02', character: 'Mei', exactLine: '就在门后。', emotion: 'certain', delivery: 'briefly', volume: 'normal', lipSync: true, source: 'story_required' }] }),
  ], [], { duration: 12, referenceAudioNames: ['Lin', 'Mei'], hasVoiceReferences: true });
  assert.equal((prompt.match(/你看见了吗？/g) || []).length, 1);
  assert.equal((prompt.match(/就在门后。/g) || []).length, 1);
  assert.match(prompt, /<Audio 1> is the voice-timbre reference exclusively for <Subject 1>/);
  assert.match(prompt, /<Audio 2> is the voice-timbre reference exclusively for <Subject 2>/);
  assert.match(prompt, /<Subject 1> \(S01\) alone speaks once/);
  assert.match(prompt, /<Subject 2> \(S02\) alone speaks once/);
  assert.match(prompt, /only one scheduled speaker vocalizes at a time/);
  assert.ok(prompt.indexOf('你看见了吗？') < prompt.indexOf('就在门后。'));
  assert.ok(prompt.length <= 7000);
});

test('writes first/last-frame H3 prompts in the official base-mode structure', () => {
  const prompt = buildVideoSegmentPrompt([shot(1)], [], { duration: 8, firstFrameUrl: 'data:image/jpeg;base64,AA==' });
  assert.match(prompt, /^How the reference pictures align with the target video/);
  assert.match(prompt, /integrated_multimodal_description:/);
  assert.match(prompt, /Picture 2 .* 8\.00-second mark/);
  assert.match(prompt, /non_diegetic_music: N\/A$/);
  assert.doesNotMatch(prompt, /subject_definitions:/);
  assert.ok(prompt.length <= 7000);
});

test('applies distinct directing and sound rules for each production style', () => {
  const natural = buildVideoSegmentPrompt([shot(1)], [], { duration: 8 });
  const documentary = buildVideoSegmentPrompt([
    shot(1, { visualStyle: 'documentary' }),
  ], [], { duration: 8 });
  const anime = buildVideoSegmentPrompt([
    shot(1, { visualStyle: 'anime' }),
  ], [], { duration: 8 });

  assert.match(natural, /Authentic direct-camera live action/);
  assert.match(natural, /Subtext-first micro-performance/i);
  assert.match(documentary, /phone, mirrorless or shoulder-camera observation/i);
  assert.match(documentary, /Location sound dominates/);
  assert.match(anime, /anticipation → key pose → impact → recovery/);
  assert.match(anime, /Precise cloth, wind and impact cues/);
  assert.notEqual(natural, documentary);
  assert.notEqual(documentary, anime);
  assert.ok(natural.length <= 7000);
  assert.ok(documentary.length <= 7000);
  assert.ok(anime.length <= 7000);
});

test('keeps all nine production styles complete and independently directed', () => {
  assert.equal(PRODUCTION_STYLE_PRESETS.length, 9);
  assert.equal(new Set(PRODUCTION_STYLE_PRESETS.map(style => style.h3Direction)).size, 9);
  assert.equal(new Set(PRODUCTION_STYLE_PRESETS.map(style => style.sound)).size, 9);

  PRODUCTION_STYLE_PRESETS.forEach(style => {
    const contract = buildVideoStyleContract(style.value);
    assert.match(contract, /LOOK:/);
    assert.match(contract, /CAMERA SYSTEM:/);
    assert.match(contract, /PERFORMANCE & MOTION:/);
    assert.match(contract, /EDITING & RHYTHM:/);
    assert.match(contract, /SOUND TEXTURE:/);
    assert.ok(contract.includes(style.performance));
    assert.ok(contract.includes(style.sound));
  });
});
