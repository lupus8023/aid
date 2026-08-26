import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';

const shot = (sceneNumber, extra = {}) => ({
  id: `shot-${sceneNumber}`,
  sceneNumber,
  description: `The protagonist crosses zone ${sceneNumber}, changes direction, and reaches a different final pose.`,
  action: `The protagonist crosses zone ${sceneNumber}, changes direction, and reaches a different final pose.`,
  prompt: '',
  characters: ['Lin'],
  objects: ['red envelope'],
  imageUrl: `https://example.com/${sceneNumber}.jpg`,
  status: 'completed',
  durationHint: 3,
  visualStyle: 'cinematic-natural',
  audioPlan: { backgroundHuman: 'none', environment: [], foley: [], music: 'none', silenceBefore: 0.8, silenceAfter: 1 },
  ...extra,
});

function dialogueTags(prompt) {
  return [...prompt.matchAll(/<d>\[([^\]]+)]\s*([\s\S]*?)<\/d>/g)].map(match => ({ language: match[1], text: match[2] }));
}

test('rejects a continuous line that cannot fit H3 15 seconds', () => {
  assert.throws(() => buildVideoSegmentPrompt([shot(4, {
    dialogueLines: [
      { character: 'Lin', text: 'You have carried every gate since dawn, and your hands are already shaking.' },
      { character: 'Lin', text: 'I cannot leave while the whole city still believes only I can hold back the sea.' },
      { character: 'Lin', text: 'Then trust us long enough to learn that the city can stand beside you.' },
    ],
  })], [], { duration: 15, referenceAudioNames: ['Lin'], language: 'en' }), /连续台词过长/);
});

test('writes Ref2VA prompts in the official six-section natural-language format', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1),
    shot(2, { dialogueLines: [{ character: 'Lin', text: '线索就在这里。' }] }),
    shot(3),
  ], [], { duration: 15, referenceAudioNames: ['Lin'] });
  const fields = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:'];
  let cursor = -1;
  for (const field of fields) {
    const next = prompt.indexOf(field);
    assert.ok(next > cursor, `${field} is missing or out of order`);
    cursor = next;
  }
  assert.doesNotMatch(prompt, /timeline_json|aid_h3_timeline|audio_event_lock|shot_contracts|dialogue_events|first_word_at|final_word_complete_by/);
  assert.match(prompt, /\[Shot 1] The shot begins from <Picture 1>/);
  assert.match(prompt, /\[Shot 2] At 00:\d{2}\.\d{3}, the camera cuts to/);
  assert.match(prompt, /At 00:\d{2}\.\d{3}, <Subject 1> \(Lin\) \(S1\).*<d>\[Chinese] 线索就在这里。<\/d>/);
  assert.equal((prompt.match(/线索就在这里。/g) || []).length, 1);
  assert.match(prompt, /No subtitles, captions, titles, speech bubbles, logos, watermarks/);
  assert.match(prompt, /non_diegetic_music:\s+N\/A/);
  assert.ok(prompt.length <= 7000);
});

test('keeps silent clips free of dialogue and quarantines refreshed-prompt speech', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, { characters: ['Lin', 'Mei'] })], [], {
    duration: 6,
    visualOverride: 'Camera pushes in.\noverall_soundscape: Mei whispers a new line.\n<d>[Chinese] 临时加一句</d>',
  });
  assert.match(prompt, /Camera pushes in/);
  assert.doesNotMatch(prompt, /临时加一句|Mei whispers|<d>/);
  assert.match(prompt, /overall_soundscape:\s+A quiet, perspective-correct location room tone/);
});

test('locks generated speech to the project language', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, {
    dialogueLines: [{ character: 'Lin', text: 'The answer is already here.' }],
  })], [], { duration: 7, language: 'en' });
  assert.deepEqual(dialogueTags(prompt), [{ language: 'English', text: 'The answer is already here.' }]);
  assert.throws(() => buildVideoSegmentPrompt([shot(2, {
    dialogueLines: [{ character: 'Lin', text: '答案就在这里。' }],
  })], [], { duration: 7, language: 'en' }), /项目对白语言为 English/);
});

test('keeps localized natural-language templates separate from still-image prompts', () => {
  const chinese = buildVideoSegmentPrompt([shot(1, {
    characters: ['Dr. Pan'], objects: ['面膜', '成分表'],
    action: 'Dr. Pan展示一种新面膜及其成分表。',
    consequence: '观众开始关注面膜成分的作用。',
    prompt: 'Premium English still-image direction that must never enter H3.',
    cameraMove: '固定',
    speech: [{ speakerId: 'S01', character: 'Dr. Pan', exactLine: '这些成分可以给肌肤补充营养。', emotion: '专业而克制', delivery: '自然', volume: 'normal', lipSync: true, source: 'story_required' }],
  })], [], { duration: 8, language: 'zh', referenceAudioNames: ['Dr. Pan'] });
  assert.match(chinese, /\[Shot 1] <Picture 1> 是本镜头的起始画面/);
  assert.match(chinese, /Dr\. Pan展示一种新面膜及其成分表/);
  assert.match(chinese, /<d>\[Chinese] 这些成分可以给肌肤补充营养。<\/d>/);
  assert.doesNotMatch(chinese, /Premium English still-image direction|观众开始关注/);

  const english = buildVideoSegmentPrompt([shot(1, {
    action: 'Lin raises the package and points to its label.', prompt: 'Unrelated still-image prompt.',
  })], [], { duration: 8, language: 'en' });
  assert.match(english, /Lin raises the package and points to its label/);
  assert.doesNotMatch(english, /Unrelated still-image prompt|画面中可见|相机采用/);
});

test('binds sequential speakers to stable subjects and audio references', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S01', character: 'Lin', exactLine: '你看见了吗？', emotion: 'alert', delivery: 'quietly', volume: 'soft', lipSync: true, source: 'story_required' }] }),
    shot(2, { characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S02', character: 'Mei', exactLine: '就在门后。', emotion: 'certain', delivery: 'briefly', volume: 'normal', lipSync: true, source: 'story_required' }] }),
  ], [], { duration: 12, referenceAudioNames: ['Lin', 'Mei'] });
  assert.match(prompt, /<Audio 1> is the voice-timbre reference for <Subject 1> \(S1\)/);
  assert.match(prompt, /<Audio 2> is the voice-timbre reference for <Subject 2> \(S2\)/);
  assert.match(prompt, /<Subject 1> \(Lin\) \(S1\), using the voice timbre from <Audio 1>/);
  assert.match(prompt, /<Subject 2> \(Mei\) \(S2\), using the voice timbre from <Audio 2>/);
  assert.ok(prompt.indexOf('你看见了吗？') < prompt.indexOf('就在门后。'));
  assert.equal(dialogueTags(prompt).length, 2);
});

test('keeps abstract meaning and relationship prose out of shot descriptions', () => {
  const leaked = 'Dr. Pan回应疑问，观众暂时接受营养供给依据，但继续等待输送机制。';
  const prompt = buildVideoSegmentPrompt([shot(1, {
    characters: ['Dr. Pan'], action: 'Dr. Pan抬起面膜包装，用食指点向成分表。',
    consequence: '功效解释从抽象宣传转向成分依据。', informationGain: '观众理解产品价值。',
    stateBefore: { relationships: leaked, emotion: '专业而克制' }, stateAfter: { relationships: leaked, emotion: '专业而克制' },
    editBridge: `${leaked} audienceInference: waiting`,
    speech: [{ speakerId: 'S01', character: 'Dr. Pan', exactLine: '这些成分可以给肌肤补充营养。', emotion: '专业而克制', delivery: '自然', volume: 'normal', lipSync: true, source: 'story_required' }],
  })], [], { duration: 8, language: 'zh', referenceAudioNames: ['Dr. Pan'] });
  assert.match(prompt, /Dr\. Pan抬起面膜包装，用食指点向成分表/);
  assert.doesNotMatch(prompt, /暂时接受营养供给依据|继续等待输送机制|功效解释从抽象宣传|观众理解产品价值|audienceInference|可见后果[:：]/);
});

test('drops directing instructions, absent-speaker lines, and quoted visual dialogue', () => {
  const directing = buildVideoSegmentPrompt([shot(1, {
    speech: [{ speakerId: 'S01', character: 'Lin', exactLine: '无其他角色在场', emotion: 'neutral', delivery: 'plainly', volume: 'normal', lipSync: true, source: 'story_required' }],
  })], [], { duration: 6, language: 'zh' });
  assert.doesNotMatch(directing, /无其他角色在场|<d>/);

  const absent = buildVideoSegmentPrompt([shot(2, {
    characters: ['Lin'], action: 'Lin runs toward the gate.',
    speech: [{ speakerId: 'S02', character: 'Mei', exactLine: '我还在这里。', emotion: 'urgent', delivery: 'fast', volume: 'raised', lipSync: true, source: 'story_required' }],
  })], [], { duration: 6, language: 'zh' });
  assert.doesNotMatch(absent, /我还在这里|<d>/);

  const quoted = buildVideoSegmentPrompt([shot(3, {
    action: 'Lin braces the closing wall and pulls the stone free.',
    description: 'Lin咬紧牙关喘息着喊：“不能停！”随后拉出石头。',
    speech: [{ speakerId: 'S01', character: 'Lin', exactLine: '不能停！', emotion: 'determined', delivery: 'urgent', volume: 'raised', lipSync: true, source: 'story_required' }],
  })], [], { duration: 6, language: 'zh' });
  assert.equal((quoted.match(/不能停！/g) || []).length, 1);
  assert.doesNotMatch(quoted, /喘息着喊/);
});

test('preserves grouped storyboards as official timed shot paragraphs', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { action: 'Lin snatches the red envelope from the moving bicycle.', cameraMove: '跟拍' }),
    shot(2, { action: 'Lin tears the seal and recoils from the photograph.', cameraMove: '推近', dialogueLines: [{ character: 'Lin', text: '这不是我的照片。' }] }),
    shot(3, { action: 'Lin pivots toward the station clock and runs.', cameraMove: '横移' }),
  ], [], { duration: 15, language: 'zh' });
  assert.equal((prompt.match(/\[Shot \d+]/g) || []).length >= 3, true);
  assert.match(prompt, /\[Shot 2] 在 00:\d{2}\.\d{3}，镜头切到/);
  for (const action of ['Lin snatches the red envelope', 'Lin tears the seal', 'Lin pivots toward the station clock']) assert.match(prompt, new RegExp(action));
  assert.doesNotMatch(prompt, /timeline_json|\{"schema"/);
});

test('merges one character into one tagged line without an end timestamp', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { dialogueLines: [{ character: 'Lin', text: 'The first result confirms the pattern.' }] }),
    shot(2, { dialogueLines: [{ character: 'Lin', text: 'The final result shows the same cause.' }] }),
  ], [], { duration: 12, language: 'en', referenceAudioNames: ['Lin'] });
  assert.equal(dialogueTags(prompt).length, 1);
  assert.match(dialogueTags(prompt)[0].text, /first result confirms.*final result shows/i);
  assert.doesNotMatch(prompt, /end by|complete by|final_word|duration_policy|speech window/i);
});

test('preserves physical action without screenplay consequence labels', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, {
    action: 'Lin grips the wet rope, pulls hard, then releases it.',
    consequence: 'Visible result: the audience realizes the mechanism is safe.',
  })], [], { duration: 7, language: 'en' });
  assert.match(prompt, /Lin grips the wet rope, pulls hard, then releases it/);
  assert.doesNotMatch(prompt, /Visible result|audience realizes|motion_physics|blocking_relation/);
});

test('uses the official three-field base format for first-and-last-frame generation', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, { action: 'Lin turns and reaches the doorway.' })], [], {
    firstFrameUrl: 'https://example.com/first.jpg', duration: 8, language: 'en',
  });
  assert.match(prompt, /^How the reference pictures align with the target video/);
  assert.match(prompt, /integrated_multimodal_description:/);
  assert.match(prompt, /<Picture 1> and <Picture 2>/);
  assert.match(prompt, /naturally reaches the composition in <Picture 2>/);
  assert.doesNotMatch(prompt, /subject_definitions:|timeline_json|aid_h3_timeline/);
  assert.match(prompt, /overall_soundscape:/);
  assert.match(prompt, /non_diegetic_music: N\/A/);
});
