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
  assert.match(prompt, /00:\d{2}\.\d{3}–00:\d{2}\.\d{3} <Subject 1> \(S63\)/);
  const soundscape = prompt.split('overall_soundscape:')[1].split('non_diegetic_music:')[0];
  assert.doesNotMatch(soundscape, /<d>|线索就在这里|dialogue|speech/i);
  assert.match(prompt, /CAMERA: .*moderate/i);
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
  assert.match(prompt, /Visual-only override: Camera pushes in/);
  assert.doesNotMatch(prompt, /临时加一句|Mei whispers/);
  assert.doesNotMatch(prompt, /<d>|SPEECH_EVENT|SPEECH_WHITELIST/);
  assert.match(prompt, /overall_soundscape:\s+A quiet, perspective-correct location room tone/);
});

test('locks H3 speech to the project language and rejects mismatched generated dialogue', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { dialogueLines: [{ character: 'Lin', text: 'The answer is already here.' }] }),
  ], [], { duration: 7, language: 'en' });
  assert.match(prompt, /<d>\[English\] The answer is already here\.<\/d>/);
  assert.equal((prompt.match(/The answer is already here\./g) || []).length, 1);

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
  assert.match(prompt, /<Audio 1> = timbre only for <Subject 1> \(S01\)/);
  assert.match(prompt, /<Audio 2> = timbre only for <Subject 2> \(S02\)/);
  assert.match(prompt, /<Subject 1> \(S01\); NON_SPOKEN_PERFORMANCE=/);
  assert.match(prompt, /<Subject 2> \(S02\); NON_SPOKEN_PERFORMANCE=/);
  assert.ok(prompt.indexOf('你看见了吗？') < prompt.indexOf('就在门后。'));
  assert.ok(prompt.length <= 7000);
});

test('drops model-written stage directions before they can become H3 dialogue', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, {
      prompt: 'Lin crosses the doorway. 无其他角色在场。其他角色保持沉默。',
      speech: [{
        speakerId: 'S01',
        character: 'Lin',
        exactLine: '无其他角色在场',
        emotion: 'neutral',
        delivery: 'plainly',
        volume: 'normal',
        lipSync: true,
        listenerState: '其他角色保持沉默',
        source: 'story_required',
      }],
    }),
  ], [], { duration: 6, language: 'zh' });

  assert.doesNotMatch(prompt, /无其他角色在场|其他角色保持沉默|<d>/);
  assert.doesNotMatch(prompt, /<d>/);
  assert.match(prompt, /CAST=\{<Subject 1> \(Lin\)\}/);
});

test('keeps performance directions non-spoken and emits only exact dialogue inside H3 dialogue tags', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, {
      speech: [{
        speakerId: 'S01',
        character: 'Lin',
        exactLine: '先短暂停顿，再以坚定语气说：“女娲娘娘，请借我力量！”',
        emotion: '坚定但克制',
        delivery: '先短暂停顿，再以坚定语气说',
        volume: 'raised',
        lipSync: true,
        source: 'story_required',
      }],
    }),
  ], [], { duration: 7, language: 'zh' });

  assert.match(prompt, /SPOKEN_WORDS_ONLY=<d>\[Chinese\] 女娲娘娘，请借我力量！<\/d>/);
  assert.match(prompt, /NON_SPOKEN_PERFORMANCE=\{emotion:controlled_determination,onset:brief_pre_line_pause,pace:natural_pace\}/);
  assert.equal((prompt.match(/先短暂停顿，再以坚定语气说/g) || []).length, 0);
  assert.equal((prompt.match(/女娲娘娘，请借我力量！/g) || []).length, 1);
});

test('removes inline quoted dialogue and vocal directions from visual channels', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, {
      action: 'Lin braces the closing ice wall and pulls the yellow stone free.',
      prompt: 'Lin rushes forward, 咬紧牙关喘息着喊：“不能停！”随后拉出黄色石头。',
      description: 'Lin rushes forward, 咬紧牙关喘息着喊：“不能停！”随后拉出黄色石头。',
      speech: [{
        speakerId: 'S01',
        character: 'Lin',
        exactLine: '不能停！',
        emotion: 'determined',
        delivery: 'urgent',
        volume: 'raised',
        lipSync: true,
        source: 'story_required',
      }],
    }),
  ], [], { duration: 6, language: 'zh' });

  assert.equal((prompt.match(/不能停！/g) || []).length, 1);
  assert.doesNotMatch(prompt, /喘息着喊|咬紧牙关喘息/);
  assert.match(prompt, /SPOKEN_WORDS_ONLY=<d>\[Chinese\] 不能停！<\/d>/);
});

test('preserves every grouped storyboard as a complete timed action-camera-dialogue unit', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { action: 'Lin snatches the red envelope from the moving bicycle.', cameraMove: '跟拍', dialogueLines: [] }),
    shot(2, { action: 'Lin tears the seal and recoils from the photograph.', cameraMove: '推近', dialogueLines: [{ character: 'Lin', text: '这不是我的照片。' }] }),
    shot(3, { action: 'Lin pivots toward the station clock and breaks into a run.', cameraMove: '横移', dialogueLines: [] }),
  ], [], { duration: 15, language: 'zh' });

  assert.match(prompt, /\[Shot 1 \| 00:00\.000–00:\d{2}\.\d{3} \| \d+\.\ds\]/);
  assert.match(prompt, /\[Shot 2 \| 00:\d{2}\.\d{3}–00:\d{2}\.\d{3} \| \d+\.\ds\]/);
  assert.match(prompt, /\[Shot 3 \| 00:\d{2}\.\d{3}–00:15\.000 \| \d+\.\ds\]/);
  for (const action of [
    'Lin snatches the red envelope from the moving bicycle.',
    'Lin tears the seal and recoils from the photograph.',
    'Lin pivots toward the station clock and breaks into a run.',
  ]) assert.equal((prompt.match(new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.equal((prompt.match(/CAMERA:/g) || []).length, 3);
  assert.equal((prompt.match(/DIALOGUE:/g) || []).length, 3);
  assert.equal((prompt.match(/TO \[Shot/g) || []).length, 2);
  assert.doesNotMatch(prompt, /cross-dissolve|fade from|fade into/i);
  assert.ok(prompt.length <= 7000, `prompt exceeds H3's 7000-character limit: ${prompt.length}`);
});

test('writes first/last-frame H3 prompts in the official base-mode structure', () => {
  const prompt = buildVideoSegmentPrompt([shot(1)], [], { duration: 8, firstFrameUrl: 'data:image/jpeg;base64,AA==' });
  assert.match(prompt, /^How the reference pictures align with the target video/);
  assert.match(prompt, /integrated_multimodal_description:/);
  assert.match(prompt, /Picture 2 .* 8\.00-second mark/);
  assert.match(prompt, /final 16% to resolve into it/);
  assert.match(prompt, /do not uniformly interpolate or slow one gesture/);
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
  assert.match(anime, /anticipation → key pose → impact → recovery/);
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
