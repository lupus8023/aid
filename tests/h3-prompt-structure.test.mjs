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
  assert.match(prompt, /\[Shot 1] The shot follows <Picture 1> as its composition reference/);
  assert.match(prompt, /\[Shot 2] At 00:\d{2}\.\d{3}, make a clean hard cut/);
  assert.match(prompt, /At 00:\d{2}\.\d{3}, <Subject 1> \(S1\) begins speaking.*<d>\[Chinese] 线索就在这里。<\/d>/);
  assert.equal((prompt.match(/线索就在这里。/g) || []).length, 1);
  assert.match(prompt, /CLEAN-FRAME PRESENTATION: Keep <d> audio-only/);
  assert.match(prompt, /No visible subtitles, captions, dialogue glyphs, phonetic text, or romanization/);
  assert.equal((prompt.match(/CLEAN-FRAME PRESENTATION/g) || []).length, 1);
  assert.match(prompt, /REFERENCE PRIORITY: Each declared picture is the composition authority for its own discrete shot/);
  assert.match(prompt, /EDITORIAL GRAMMAR: Treat every picture as a separate photographed setup/);
  assert.match(prompt, /do not crossfade, morph, interpolate, repeat, or soften a hard cut/);
  assert.match(prompt, /natural skin micro-texture and fine facial detail/);
  assert.match(prompt, /SCRIPT DIALOGUE LOCK: <d> is authoritative soundtrack speech/);
  assert.match(prompt, /From 00:\d{2}\.\d{3} to 00:\d{2}\.\d{3}/);
  assert.doesNotMatch(prompt, /闭嘴|嘴巴闭合|说完最后一个字|mouth closes|final word|says once/i);
  assert.match(prompt, /non_diegetic_music:\s+N\/A/);
  assert.ok(prompt.length <= 7000);
});

test('locks one storyboard as the exact I2VA first frame and limits allowed change', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, {
    performance: [{
      character: 'Lin', objective: 'hold back tears', blocking: 'keeps her shoulders still',
      gesture: 'fingers tighten once', expression: 'restrained grief', gaze: 'slowly lifts her eyes',
      breath: 'shallow breathing', reaction: 'one tear gathers', subtext: 'do not let anyone see the fear',
    }],
  })], [], { duration: 8, language: 'en' });
  assert.match(prompt, /REFERENCE PRIORITY — LOCK to <Picture 1>; DO NOT REDRAW/);
  assert.match(prompt, /exact first frame at 00:00\.000, not loose style inspiration/);
  assert.match(prompt, /Only the explicitly described physical action, micro-expression, gaze, breathing, camera movement, and physically caused effects may change/);
  assert.match(prompt, /natural skin micro-texture and fine facial detail/);
  assert.match(prompt, /Avoid waxy or plastic skin, beauty-filter smoothing/);
  assert.match(prompt, /From 00:00\.000 to 00:\d{2}\.\d{3}/);
  assert.doesNotMatch(prompt, /8K|HDR|ultra[- ]?high definition/i);
});

test('keeps silent clips free of dialogue and quarantines refreshed-prompt speech', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, { characters: ['Lin', 'Mei'] })], [], {
    duration: 6,
    visualOverride: 'Camera pushes in.\noverall_soundscape: Mei whispers a new line.\n<d>[Chinese] 临时加一句</d>',
  });
  assert.match(prompt, /Camera pushes in/);
  assert.doesNotMatch(prompt, /临时加一句|Mei whispers|<d>/);
  assert.match(prompt, /overall_soundscape:\s+Natural location ambience stays clearly audible beneath dialogue and through pauses/);
});

test('treats a punctuation-only screenplay turn as a silent performance pause, not English speech', () => {
  const prompt = buildVideoSegmentPrompt([shot(4, {
    characters: ['裴行简', '沈贵妃'],
    action: '裴行简压低目光回答；沈贵妃沉默片刻。',
    speech: [
      { speakerId: 'S01', character: '裴行简', exactLine: '也……买不到。主要是，还没开始卖。', emotion: '克制', delivery: '迟疑', volume: 'normal', lipSync: true, source: 'user_exact' },
      { speakerId: 'S02', character: '沈贵妃', exactLine: '……', emotion: '意外', delivery: '停顿', volume: 'normal', lipSync: true, source: 'user_exact' },
    ],
  })], [], { duration: 10, language: 'zh', referenceAudioNames: ['裴行简'] });
  assert.deepEqual(dialogueTags(prompt), [{ language: 'Chinese', text: '也……买不到。主要是，还没开始卖。' }]);
  assert.doesNotMatch(prompt, /<d>\[English]|<d>\[Chinese] ……<\/d>/);
  assert.match(prompt, /CLEAN-FRAME PRESENTATION: Keep <d> audio-only/);
});

test('retains later-shot ambience and binds Foley to its own shot across locations', () => {
  const shots = Array.from({ length: 4 }, (_, i) => shot(i + 1, {
    locationId: `location-${i + 1}`,
    audioPlan: {
      backgroundHuman: i === 1 ? 'indistinct_nonverbal' : 'none',
      environment: [`location-${i + 1} wind`, `location-${i + 1} water`],
      foley: [`object-${i + 1} click`, `object-${i + 1} scrape`],
      music: 'none', silenceBefore: 0.8, silenceAfter: 1,
    },
  }));
  const prompt = buildVideoSegmentPrompt(shots, [], { duration: 15, language: 'en' });
  const soundscape = prompt.split('overall_soundscape:')[1].split('non_diegetic_music:')[0];
  for (let i = 1; i <= 4; i += 1) {
    const scope = soundscape.split(`[Shot ${i}]`)[1].split('[Shot ')[0];
    assert.match(scope, new RegExp(`location-${i} wind; location-${i} water`));
    assert.match(scope, new RegExp(`object-${i} click; object-${i} scrape`));
    assert.doesNotMatch(scope, new RegExp(`(?:location|object)-(?!${i})[1-4]`));
    assert.equal(scope.includes('wordless murmur'), i === 2);
  }
  assert.match(soundscape, /retain it through speech pauses/);
  assert.match(soundscape, /same-location cuts and change it with the location/);
  assert.match(prompt, /non_diegetic_music:\s+N\/A/);
  assert.ok(prompt.length <= 7000);
});

test('preserves intentionally silent and distant sound plans instead of replacing their sources', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { audioPlan: { environment: ['intentional complete silence'], foley: [], music: 'none', backgroundHuman: 'none' } }),
    shot(2, { audioPlan: { environment: ['distant surf behind a closed window'], foley: [], music: 'none', backgroundHuman: 'none' } }),
  ], [], { duration: 10, language: 'en' });
  const soundscape = prompt.split('overall_soundscape:')[1].split('non_diegetic_music:')[0];
  assert.match(soundscape, /Respect intentional silence/);
  assert.match(soundscape, /\[Shot 1] Location bed: intentional complete silence/);
  assert.match(soundscape, /\[Shot 2] Location bed: distant surf behind a closed window/);
  assert.doesNotMatch(soundscape, /wordless murmur|Action Foley|natural ambience matching/);
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

test('keeps visual direction English for Chinese H3 projects and preserves exact Chinese dialogue', () => {
  const videoDirection = {
    action: 'Dr. Pan抬起面膜包装，再用食指点向印刷成分表。',
    camera: '固定中景同时容纳他的双手、包装和成分表。',
    detail: '包装薄膜随手指接触产生一道短暂反光。',
    ending: '包装正面仍朝向镜头，食指停在成分表旁。',
  };
  const chinese = buildVideoSegmentPrompt([shot(1, {
    characters: ['Dr. Pan'], objects: ['面膜', '成分表'],
    action: 'Dr. Pan展示一种新面膜及其成分表。',
    consequence: '观众开始关注面膜成分的作用。',
    prompt: 'Dr. Pan raises a face-mask package and points to the printed ingredient panel. A medium eye-level camera frames his hands and the package.',
    cameraMove: '固定',
    videoDirection,
    speech: [{ speakerId: 'S01', character: 'Dr. Pan', exactLine: '这些成分可以给肌肤补充营养。', emotion: '专业而克制', delivery: '自然', volume: 'normal', lipSync: true, source: 'story_required' }],
  })], [], { duration: 8, language: 'zh', referenceAudioNames: ['Dr. Pan'] });
  for (const value of Object.values(videoDirection)) assert.ok(!chinese.includes(value), value);
  assert.match(chinese, /Dr\. Pan raises a face-mask package and points to the printed ingredient panel/);
  assert.match(chinese, /<d>\[Chinese] 这些成分可以给肌肤补充营养。<\/d>/);
  assert.match(chinese, /Keep <d> audio-only/);
  assert.doesNotMatch(chinese, /观众开始关注|闭嘴|mouth closes|final word/i);
  assert.doesNotMatch(chinese.replace(/<d>[\s\S]*?<\/d>/g, ''), /[\u3400-\u9fff]/);

  const english = buildVideoSegmentPrompt([shot(1, {
    action: 'Lin raises the package and points to its label.', prompt: 'Unrelated still-image prompt.',
  })], [], { duration: 8, language: 'en' });
  assert.match(english, /Lin raises the package and points to its label/);
  assert.doesNotMatch(english, /Unrelated still-image prompt|画面中可见|相机采用/);
});

test('binds sequential speakers to stable subjects and audio references', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { clipType: 'dialogue', dialogueUnitId: 'door-exchange', characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S01', character: 'Lin', exactLine: '你看见了吗？', emotion: 'alert', delivery: 'quietly', volume: 'soft', lipSync: true, source: 'story_required' }] }),
    shot(2, { clipType: 'dialogue', dialogueUnitId: 'door-exchange', characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S02', character: 'Mei', exactLine: '就在门后。', emotion: 'certain', delivery: 'briefly', volume: 'normal', lipSync: true, source: 'story_required' }] }),
  ], [], { duration: 12, referenceAudioNames: ['Lin', 'Mei'] });
  assert.match(prompt, /<Audio 1> is the voice-timbre reference for <Subject 1> \(S1\)/);
  assert.match(prompt, /<Audio 2> is the voice-timbre reference for <Subject 2> \(S2\)/);
  assert.match(prompt, /<Subject 1> \(S1\) begins speaking using the voice timbre referenced from <Audio 1>/);
  assert.match(prompt, /<Subject 2> \(S2\) begins speaking using the voice timbre referenced from <Audio 2>/);
  assert.match(prompt, /cut on the conversational turn.*shot\/reverse-shot response/);
  assert.match(prompt, /preserve the shared eyeline, 180-degree axis, screen direction, and listener timing/);
  assert.ok(prompt.indexOf('你看见了吗？') < prompt.indexOf('就在门后。'));
  assert.equal(dialogueTags(prompt).length, 2);
});

test('keeps abstract meaning and relationship prose out of shot descriptions', () => {
  const leaked = 'Dr. Pan回应疑问，观众暂时接受营养供给依据，但继续等待输送机制。';
  const prompt = buildVideoSegmentPrompt([shot(1, {
    characters: ['Dr. Pan'], action: 'Dr. Pan抬起面膜包装，用食指点向成分表。',
    prompt: 'Dr. Pan raises the face-mask package and points one index finger toward the ingredient panel.',
    consequence: '功效解释从抽象宣传转向成分依据。', informationGain: '观众理解产品价值。',
    stateBefore: { relationships: leaked, emotion: '专业而克制' }, stateAfter: { relationships: leaked, emotion: '专业而克制' },
    editBridge: `${leaked} audienceInference: waiting`,
    speech: [{ speakerId: 'S01', character: 'Dr. Pan', exactLine: '这些成分可以给肌肤补充营养。', emotion: '专业而克制', delivery: '自然', volume: 'normal', lipSync: true, source: 'story_required' }],
  })], [], { duration: 8, language: 'zh', referenceAudioNames: ['Dr. Pan'] });
  assert.match(prompt, /Dr\. Pan raises the face-mask package and points one index finger toward the ingredient panel/);
  assert.doesNotMatch(prompt, /暂时接受营养供给依据|继续等待输送机制|功效解释从抽象宣传|观众理解产品价值|audienceInference|可见后果[:：]/);
});

test('removes the Chinese visible cue and abstract summary prose from every directing section', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, {
    characters: ['熊猫博士'],
    objects: ['线雕面膜'],
    action: '熊猫博士总结面膜价值。',
    description: '熊猫博士总结面膜价值。',
    prompt: 'Dr. Pan holds the face mask at chest height and turns the package toward the camera.',
    cameraMove: '摇镜，跟随可见动作',
    audioPlan: {
      backgroundHuman: 'none', environment: ['low laboratory room tone'], foley: ['soft package rustle'],
      music: 'none', silenceBefore: 0.8, silenceAfter: 1,
    },
  })], [], { duration: 7, language: 'zh' });
  assert.doesNotMatch(prompt, /可见|总结面膜价值/);
  assert.match(prompt, /Dr\. Pan holds the face mask at chest height/);
  assert.doesNotMatch(prompt, /物体包括|动作走位|画面侧/);
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
    shot(1, { clipType: 'action', action: 'Lin snatches the red envelope from the moving bicycle.', cameraMove: '跟拍' }),
    shot(2, { clipType: 'reaction', action: 'Lin tears the seal and recoils from the photograph.', cameraMove: '推近', dialogueLines: [{ character: 'Lin', text: '这不是我的照片。' }] }),
    shot(3, { action: 'Lin pivots toward the station clock and runs.', cameraMove: '横移' }),
  ], [], { duration: 15, language: 'zh' });
  assert.equal((prompt.match(/\[Shot \d+]/g) || []).length >= 3, true);
  assert.match(prompt, /\[Shot 2] At 00:\d{2}\.\d{3}, cut on the completed physical action to the composition referenced by <Picture 2>/);
  assert.match(prompt, /the reaction begins immediately from that impact/);
  for (const action of ['Lin snatches the red envelope', 'Lin tears the seal', 'Lin pivots toward the station clock']) assert.match(prompt, new RegExp(action));
  assert.doesNotMatch(prompt, /timeline_json|\{"schema"/);
  assert.doesNotMatch(prompt, /reference——|物体包括|既定|视线轴|画面侧|动作走位|决定性|透视关系/);
});

test('fits a four-shot continuity segment with verbose actor direction inside the H3 limit', () => {
  const verboseCue = (character, index) => ({
    character,
    blocking: `${character} starts beside marker ${index}, transfers weight through a grounded step, completes the principal action, and lands in a readable final pose. `.repeat(5),
    gesture: `${character} makes one precise hand gesture toward the story object. `.repeat(4),
    expression: `${character}'s eyes, brow, mouth corners and jaw move from guarded tension through recognition into a restrained final expression. `.repeat(5),
    gaze: `${character} shifts gaze from the partner to the story object and holds the final eyeline. `.repeat(4),
    breath: `${character}'s breath catches, steadies, and releases with the decision. `.repeat(4),
    reaction: `${character} visibly absorbs the preceding action before changing distance and intention. `.repeat(5),
  });
  const segment = [1, 2, 3, 4].map(index => shot(index, {
    characters: ['Lin', 'Mei', 'Guard'],
    action: `Lin completes the distinct physical action for shot ${index} and changes the visible situation.`,
    performance: [verboseCue('Lin', index), verboseCue('Mei', index), verboseCue('Guard', index)],
    ...(index === 2 ? { dialogueLines: [{ character: 'Lin', text: '保持队形，跟着我。' }] } : {}),
    ...(index === 3 ? { dialogueLines: [{ character: 'Mei', text: '我看见出口了。' }] } : {}),
  }));
  const prompt = buildVideoSegmentPrompt(segment, [], {
    duration: 15,
    firstFrameUrl: 'continuity-frame',
    referenceAudioNames: ['Lin', 'Mei'],
    language: 'zh',
  });
  assert.ok(prompt.length <= 7000, `prompt was ${prompt.length} characters`);
  assert.equal((prompt.match(/\[Shot \d+]/g) || []).length >= 4, true);
  assert.equal((prompt.match(/保持队形，跟着我。/g) || []).length, 1);
  assert.equal((prompt.match(/我看见出口了。/g) || []).length, 1);
  assert.match(prompt, /Lin completes the distinct physical action for shot 1/);
  assert.match(prompt, /Lin completes the distinct physical action for shot 4/);
  assert.match(prompt, /Lin:/);
  assert.match(prompt, /Mei:/);
  assert.match(prompt, /Guard:/);
});

test('directs a master-to-detail sequence with progressive coverage and a match insert', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { clipType: 'establishing', shotSize: 'wide shot', action: 'Lin enters the archive and stops beside the central table.' }),
    shot(2, { clipType: 'action', shotSize: 'medium shot', action: 'Lin reaches toward the red envelope on the table.' }),
    shot(3, { clipType: 'insert', shotSize: 'extreme close-up', action: 'Her thumb breaks the wax seal.' }),
  ], [], { duration: 12, language: 'en' });
  assert.match(prompt, /cut from the spatial master.*move into closer dramatic coverage/);
  assert.match(prompt, /cut on the hand, gaze, or object movement.*as a precise detail insert/);
  assert.match(prompt, /match the action across the cut/);
});

test('merges one character into one tagged line without an end timestamp', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { dialogueLines: [{ character: 'Lin', text: 'The first result confirms the pattern.' }] }),
    shot(2, { dialogueLines: [{ character: 'Lin', text: 'The final result shows the same cause.' }] }),
  ], [], { duration: 12, language: 'en', referenceAudioNames: ['Lin'] });
  assert.equal(dialogueTags(prompt).length, 1);
  assert.match(dialogueTags(prompt)[0].text, /first result confirms.*final result shows/i);
  assert.doesNotMatch(prompt, /end by|complete by|final_word|duration_policy|speech window|final word|mouth|lips|jaw|stop speaking|says once/i);
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
  assert.match(prompt, /begins from <Picture 1>/);
  assert.match(prompt, /reaches the pose and composition in <Picture 2>/);
  assert.doesNotMatch(prompt, /subject_definitions:|timeline_json|aid_h3_timeline/);
  assert.match(prompt, /overall_soundscape:/);
  assert.match(prompt, /non_diegetic_music: N\/A/);
});
