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
  assert.match(prompt, /From 00:\d{2}\.\d{3} to 00:\d{2}\.\d{3}, <Subject 1> \(S63\)/);
  const soundscape = prompt.split('overall_soundscape:')[1].split('non_diegetic_music:')[0];
  assert.doesNotMatch(soundscape, /<d>|线索就在这里|dialogue|speech/i);
  assert.match(prompt, /The camera uses .*moderate/i);
  assert.doesNotMatch(prompt, /SPEECH GATE|SPOKEN_WORDS_ONLY|NON_SPOKEN_PERFORMANCE|DIALOGUE:/);
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
  assert.match(prompt, /<Audio 1> is a voice-timbre reference for <Subject 1> \(S1\)/);
  assert.match(prompt, /<Audio 2> is a voice-timbre reference for <Subject 2> \(S2\)/);
  assert.match(prompt, /<Subject 1> \(S1\) delivers one synchronized line with/);
  assert.match(prompt, /<Subject 2> \(S2\) delivers one synchronized line with/);
  assert.match(prompt, /breath, eyeline and facial tension change once/);
  assert.match(prompt, /dialogue eyeline axis\/screen sides/);
  assert.ok(prompt.indexOf('你看见了吗？') < prompt.indexOf('就在门后。'));
  assert.ok(prompt.length <= 7000);
});

test('keeps explanatory screenplay fields out of the H3 audiovisual description', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, {
      action: 'Lin catches the falling report, turns toward the door, and runs before the guard can follow.',
      cause: 'The prior success causes the council to send another urgent request.',
      conflict: 'The new workload is more than Lin can finish before nightfall.',
      choice: 'Lin chooses duty instead of asking for help.',
      consequence: 'The council assumes Lin can handle every request alone.',
      informationGain: 'The audience understands that praise is becoming a trap.',
      dialogueLines: [{ character: 'Lin', text: 'I cannot stop now.' }],
    }),
  ], [], { duration: 7, language: 'en', referenceAudioNames: ['Lin'] });

  assert.match(prompt, /Lin catches the falling report/);
  assert.doesNotMatch(prompt, /prior success causes|workload is more|praise is becoming a trap/);
  assert.match(prompt, /No narrator or ad-lib exists/);
  assert.match(prompt, /Exactly 1 intelligible vocal event/);
  assert.match(prompt, /No narration, ad-lib, singing, or unscripted intelligible words/);
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
  assert.match(prompt, /Visible cast, each exactly once: <Subject 1> \(Lin\)/);
});

test('does not send a line whose assigned character is absent from the visible action', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(2, {
      action: 'A teenage boy breaks away from the crowd and runs back into the burning village to find his sister.',
      prompt: 'A teenage boy runs toward the burning village while the mermaid remains behind him.',
      characters: ['Lin'],
      speech: [{
        speakerId: 'S01', character: 'Lin', exactLine: '我妹妹还在里面。', emotion: 'urgent',
        delivery: 'fast', volume: 'raised', lipSync: true, source: 'story_required',
      }],
    }),
  ], [], { duration: 6, language: 'zh' });

  assert.doesNotMatch(prompt, /我妹妹还在里面|<d>/);
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

  assert.match(prompt, /with restrained determination, after one brief natural pause, at a natural conversational pace/);
  assert.match(prompt, /<d>\[Chinese\] 女娲娘娘，请借我力量！<\/d>/);
  assert.doesNotMatch(prompt, /SPOKEN_WORDS_ONLY|NON_SPOKEN_PERFORMANCE/);
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
  assert.match(prompt, /<d>\[Chinese\] 不能停！<\/d>/);
});

test('preserves every grouped storyboard as a complete timed action-camera-dialogue unit', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { action: 'Lin snatches the red envelope from the moving bicycle.', cameraMove: '跟拍', dialogueLines: [] }),
    shot(2, { action: 'Lin tears the seal and recoils from the photograph.', cameraMove: '推近', dialogueLines: [{ character: 'Lin', text: '这不是我的照片。' }] }),
    shot(3, { action: 'Lin pivots toward the station clock and breaks into a run.', cameraMove: '横移', dialogueLines: [] }),
  ], [], { duration: 15, language: 'zh' });

  assert.match(prompt, /\[Shot 1\]/);
  assert.match(prompt, /\[Shot 2\] At 00:\d{2}\.\d{3},/);
  assert.match(prompt, /\[Shot 3\] At 00:\d{2}\.\d{3},/);
  for (const action of [
    'Lin snatches the red envelope from the moving bicycle.',
    'Lin tears the seal and recoils from the photograph.',
    'Lin pivots toward the station clock and breaks into a run.',
  ]) assert.equal((prompt.match(new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.equal((prompt.match(/The camera uses/g) || []).length, 3);
  assert.equal((prompt.match(/move into \[Shot/g) || []).length, 2);
  assert.doesNotMatch(prompt, /DIALOGUE:|SPEECH GATE|SPOKEN_WORDS_ONLY|NON_SPOKEN_PERFORMANCE/);
  assert.doesNotMatch(prompt, /cross-dissolve|fade from|fade into/i);
  assert.ok(prompt.length <= 7000, `prompt exceeds H3's 7000-character limit: ${prompt.length}`);
});

test('keeps causal story meaning in observable action without explanatory exposition', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, {
      action: 'Lin sees the forged seal, hides the letter, and turns away from Mei.',
      cause: 'Mei asks to read the letter.',
      conflict: 'Showing it would expose Lin\'s lie.',
      choice: 'Lin hides the letter behind his back.',
      consequence: 'Mei notices the concealment and stops trusting him.',
      informationGain: 'Lin is protecting a lie and Mei now suspects him.',
      dialoguePurpose: 'conceal',
      montageRole: 'decision',
      audienceQuestion: 'Will Mei confront him?',
      speech: [{ speakerId: 'S01', character: 'Lin', exactLine: 'There is nothing inside.', emotion: 'guarded', delivery: 'too quickly', volume: 'normal', lipSync: true, storyFunction: 'conceal', respondsTo: 'Mei asks to read the letter', source: 'story_required' }],
    }),
  ], [], { duration: 7, language: 'en' });
  assert.match(prompt, /Lin sees the forged seal, hides the letter, and turns away from Mei/);
  assert.doesNotMatch(prompt, /Mei asks to read the letter|Showing it would expose|Mei now suspects/);
  assert.equal((prompt.match(/There is nothing inside\./g) || []).length, 1);
  assert.match(prompt, /<d>\[English\] There is nothing inside\.<\/d>/);
});

test('schedules two connected lines inside one storyboard in order', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, {
      durationHint: 10,
      characters: ['Lin', 'Mei'],
      action: 'Lin offers the key to Mei; Mei studies him, accepts it, and unlocks the door.',
      speech: [
        { speakerId: 'S01', character: 'Lin', exactLine: 'You should open it.', emotion: 'uncertain', delivery: 'quietly', volume: 'soft', lipSync: true, storyFunction: 'decision', respondsTo: '', source: 'story_required' },
        { speakerId: 'S02', character: 'Mei', exactLine: 'Then stay with me.', emotion: 'steady', delivery: 'without looking away', volume: 'normal', lipSync: true, storyFunction: 'answer', respondsTo: 'You should open it.', source: 'story_required' },
      ],
      audioPlan: { backgroundHuman: 'none', environment: ['room tone'], foley: ['key contact'], music: 'none', silenceBefore: 0.5, silenceAfter: 0.6 },
    }),
  ], [], { duration: 10, language: 'en', referenceAudioNames: ['Lin', 'Mei'], hasVoiceReferences: true });
  assert.equal((prompt.match(/<d>/g) || []).length, 2);
  assert.ok(prompt.indexOf('You should open it.') < prompt.indexOf('Then stay with me.'));
});

test('uses the exact stem as timing reference while generating a complete soundtrack', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, {
      speech: [{
        speakerId: 'S01', character: 'Lin', exactLine: 'The Western Reef is still half a measure short.',
        emotion: 'focused', delivery: 'plainly', volume: 'normal', lipSync: true, source: 'story_required',
      }],
    }),
  ], [], { duration: 13, language: 'en', hasVoiceReferences: true, lockedDialogueTrack: true });

  assert.match(prompt, /<Audio 1> is the authoritative voice, timing and rhythm reference/);
  assert.match(prompt, /speaks once in the exact timing and voice of <Audio 1>/);
  assert.equal((prompt.match(/The Western Reef is still half a measure short\./g) || []).length, 1);
  assert.match(prompt, /<d>\[English\] The Western Reef is still half a measure short\.<\/d>/);
  assert.match(prompt, /continuous location ambience and visibly caused Foley/i);
  assert.match(prompt, /sole human-vocal layer/i);
});

test('locks silent H3 segments to a full-duration silent source track', () => {
  const prompt = buildVideoSegmentPrompt([shot(1)], [], {
    duration: 6,
    language: 'en',
    hasVoiceReferences: true,
    lockedDialogueTrack: true,
  });
  assert.match(prompt, /exactly 0 scheduled dialogue events/);
  assert.match(prompt, /<Audio 1> contains no vocal event/);
  assert.match(prompt, /Generate continuous non-vocal ambience and caused Foley/);
  assert.doesNotMatch(prompt, /<d>/);
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
