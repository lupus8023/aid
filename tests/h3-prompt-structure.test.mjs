import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';

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
