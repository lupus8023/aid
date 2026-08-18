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
  assert.match(prompt, /setup and dramatic question/);
  assert.match(prompt, /consequence and emotional landing/);
  assert.equal((prompt.match(/CLEAN-FRAME PRESENTATION/g) || []).length, 1);
  assert.ok(prompt.length <= 7000, `prompt exceeds H3's 7000-character limit: ${prompt.length}`);
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
