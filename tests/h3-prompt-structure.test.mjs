import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';
import { h3VisualPromptIsChinese } from '../lib/h3PromptLanguage.ts';

const shot = (sceneNumber, extra = {}) => ({
  id: `shot-${sceneNumber}`,
  sceneNumber,
  description: `主角穿过区域${sceneNumber}，改变方向后停在新的姿势。`,
  action: `主角穿过区域${sceneNumber}，改变方向后停在新的姿势。`,
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

test('writes compact Ref2VA prompts with only required H3 sections', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1),
    shot(2, { dialogueLines: [{ character: 'Lin', text: '线索就在这里。' }] }),
    shot(3),
  ], [], { duration: 15, referenceAudioNames: ['Lin'] });
  const fields = ['subject_definitions:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:'];
  let cursor = -1;
  for (const field of fields) {
    const next = prompt.indexOf(field);
    assert.ok(next > cursor, `${field} is missing or out of order`);
    cursor = next;
  }
  assert.doesNotMatch(prompt, /timeline_json|aid_h3_timeline|audio_event_lock|shot_contracts|dialogue_events|first_word_at|final_word_complete_by/);
  assert.match(prompt, /\[Shot 1] 本镜以<Picture 1>作为构图参考/);
  assert.match(prompt, /\[Shot 2] 00:\d{2}\.\d{3}时，干净硬切到<Picture 2>/);
  assert.match(prompt, /对白：<Subject 1>（S1）开始说话.*<d>\[Chinese] 线索就在这里。<\/d>/);
  assert.doesNotMatch(prompt, /At 00:\d{2}\.\d{3}, <Subject 1> \(S1\) (?:begins speaking|speaks)/);
  assert.equal((prompt.match(/线索就在这里。/g) || []).length, 1);
  assert.match(prompt, /对白只存在于音轨中/);
  assert.doesNotMatch(prompt, /\b(?:subtitles?|captions?|phonetic|romanization)\b/i);
  assert.equal((prompt.match(/对白只存在于音轨中/g) || []).length, 1);
  const detailed = prompt.split('detailed_description:')[1].split('overall_soundscape:')[0];
  assert.ok(detailed.indexOf('对白只存在于音轨中') < detailed.indexOf('[Shot 1]'));
  assert.match(prompt, /参考图：每张已声明图片锁定对应镜头的开场/);
  assert.match(prompt, /使用剧本规定的干净切镜/);
  assert.doesNotMatch(prompt, /The complete vocal track consists only of the ordered <d> blocks below/);
  assert.doesNotMatch(prompt, /summary:|retention_analysis:/);
  assert.match(prompt, /00:\d{2}\.\d{3}至00:\d{2}\.\d{3}/);
  assert.doesNotMatch(prompt, /闭嘴|嘴巴闭合|说完最后一个字|mouth closes|final word|says once/i);
  assert.match(prompt, /non_diegetic_music:\s+无。/);
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
  assert.match(prompt, /参考图：<Picture 1>是00:00\.000的准确首帧/);
  assert.match(prompt, /只执行已写明的动作、表情和运镜/);
  assert.doesNotMatch(prompt, /summary:|retention_analysis:|CAPTURE MODE:/);
  assert.match(prompt, /00:00\.000至00:\d{2}\.\d{3}/);
  assert.doesNotMatch(prompt, /8K|HDR|ultra[- ]?high definition/i);
});

test('keeps silent clips free of dialogue and quarantines refreshed-prompt speech', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, { characters: ['Lin', 'Mei'] })], [], {
    duration: 6,
    visualOverride: '镜头缓慢推近。\noverall_soundscape: Mei whispers a new line.\n<d>[Chinese] 临时加一句</d>',
  });
  assert.match(prompt, /镜头缓慢推近/);
  assert.doesNotMatch(prompt, /临时加一句|Mei whispers|<d>/);
  assert.match(prompt, /overall_soundscape:\s+保持与可见地点一致的稳定、无人声环境底噪/);
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
  assert.match(prompt, /对白只存在于音轨中/);
});

test('retains later-shot ambience and binds Foley to its own shot across locations', () => {
  const shots = Array.from({ length: 4 }, (_, i) => shot(i + 1, {
    locationId: `location-${i + 1}`,
    audioPlan: {
      backgroundHuman: i === 1 ? 'indistinct_nonverbal' : 'none',
      environment: [`地点-${i + 1}风声`, `地点-${i + 1}水声`],
      foley: [`物体-${i + 1}轻响`, `物体-${i + 1}摩擦声`],
      music: 'none', silenceBefore: 0.8, silenceAfter: 1,
    },
  }));
  const prompt = buildVideoSegmentPrompt(shots, [], { duration: 15, language: 'en' });
  const soundscape = prompt.split('overall_soundscape:')[1].split('non_diegetic_music:')[0];
  for (let i = 1; i <= 4; i += 1) {
    const scope = soundscape.split(`[Shot ${i}]`)[1].split('[Shot ')[0];
    assert.match(scope, new RegExp(`地点-${i}风声；地点-${i}水声`));
    assert.match(scope, new RegExp(`物体-${i}轻响；物体-${i}摩擦声`));
    assert.doesNotMatch(scope, new RegExp(`(?:地点|物体)-(?!${i})[1-4]`));
    assert.equal(scope.includes('模糊、无明确词语的低声人群声'), i === 2);
  }
  assert.match(soundscape, /每个地点的声音底层保持稳定且没有可辨认人声/);
  assert.match(soundscape, /只在场景变化时更换/);
  assert.match(prompt, /non_diegetic_music:\s+无。/);
  assert.ok(prompt.length <= 7000);
});

test('preserves intentionally silent and distant sound plans instead of replacing their sources', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { audioPlan: { environment: ['刻意完全静默'], foley: [], music: 'none', backgroundHuman: 'none' } }),
    shot(2, { audioPlan: { environment: ['关闭窗户后的远处海浪声'], foley: [], music: 'none', backgroundHuman: 'none' } }),
  ], [], { duration: 10, language: 'en' });
  const soundscape = prompt.split('overall_soundscape:')[1].split('non_diegetic_music:')[0];
  assert.match(soundscape, /保留剧本要求的刻意静默/);
  assert.match(soundscape, /\[Shot 1] 环境底噪：刻意完全静默/);
  assert.match(soundscape, /\[Shot 2] 环境底噪：关闭窗户后的远处海浪声/);
  assert.doesNotMatch(soundscape, /低声人群声|动作拟音/);
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

test('keeps visual direction Chinese and preserves exact project-language dialogue', () => {
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
  assert.match(chinese, /Dr\. Pan抬起已引用物体包装，再用食指点向印刷已引用物体/);
  assert.match(chinese, /<d>\[Chinese] 这些成分可以给肌肤补充营养。<\/d>/);
  assert.match(chinese, /对白只存在于音轨中/);
  assert.doesNotMatch(chinese, /观众开始关注|闭嘴|mouth closes|final word/i);
  assert.equal(h3VisualPromptIsChinese(chinese), true);
  assert.doesNotMatch(chinese, /raises a face-mask package|medium eye-level camera/);

  const english = buildVideoSegmentPrompt([shot(1, {
    action: 'Lin抬起包装并指向标签。', prompt: 'Unrelated still-image prompt.',
  })], [], { duration: 8, language: 'en' });
  assert.match(english, /Lin抬起包装并指向标签/);
  assert.doesNotMatch(english, /Unrelated still-image prompt/);
  assert.equal(h3VisualPromptIsChinese(english), true);
});

test('binds sequential speakers to stable subjects and audio references', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { clipType: 'dialogue', dialogueUnitId: 'door-exchange', characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S01', character: 'Lin', exactLine: '你看见了吗？', emotion: 'alert', delivery: 'quietly', volume: 'soft', lipSync: true, source: 'story_required' }] }),
    shot(2, { clipType: 'dialogue', dialogueUnitId: 'door-exchange', characters: ['Lin', 'Mei'], speech: [{ speakerId: 'S02', character: 'Mei', exactLine: '就在门后。', emotion: 'certain', delivery: 'briefly', volume: 'normal', lipSync: true, source: 'story_required' }] }),
  ], [], { duration: 12, referenceAudioNames: ['Lin', 'Mei'] });
  assert.match(prompt, /<Audio 1>是<Subject 1>（S1）的音色参考/);
  assert.match(prompt, /<Audio 2>是<Subject 2>（S2）的音色参考/);
  assert.match(prompt, /<Subject 1>（S1）开始说话，音色参考<Audio 1>/);
  assert.match(prompt, /<Subject 2>（S2）开始说话，音色参考<Audio 2>/);
  assert.match(prompt, /在对话轮次变化处切到.*形成正反打回应/);
  assert.match(prompt, /保持共同视线、180度轴线、银幕方向和听者反应时机/);
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
  assert.match(prompt, /Dr\. Pan抬起面膜包装，用食指点向成分表/);
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
  assert.doesNotMatch(prompt, /总结面膜价值/);
  assert.match(prompt, /完成一个自然手势，并把注意转向主要物体/);
  assert.doesNotMatch(prompt, /Dr\. Pan holds the face mask/);
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
    shot(1, { clipType: 'action', action: 'Lin从移动的自行车上夺下红包。', cameraMove: '跟拍' }),
    shot(2, { clipType: 'reaction', action: 'Lin撕开封口，看到照片后猛然后退。', cameraMove: '推近', dialogueLines: [{ character: 'Lin', text: '这不是我的照片。' }] }),
    shot(3, { action: 'Lin转向车站时钟后跑开。', cameraMove: '横移' }),
  ], [], { duration: 15, language: 'zh' });
  assert.equal((prompt.match(/\[Shot \d+]/g) || []).length >= 3, true);
  assert.match(prompt, /\[Shot 2] 00:\d{2}\.\d{3}时，在物理动作完成处切到<Picture 2>/);
  assert.match(prompt, /反应立刻承接冲击/);
  for (const action of ['Lin从移动的自行车上夺下红包', 'Lin撕开封口', 'Lin转向车站时钟后跑开']) assert.match(prompt, new RegExp(action));
  assert.doesNotMatch(prompt, /timeline_json|\{"schema"/);
  assert.doesNotMatch(prompt, /reference——|物体包括|既定|视线轴|画面侧|动作走位|决定性|透视关系/);
});

test('fits a four-shot continuity segment with verbose actor direction inside the H3 limit', () => {
  const verboseCue = (character, index) => ({
    character,
    blocking: `${character}从标记点${index}起步，重心落稳后完成主要动作，并停在清楚的最终姿势。`.repeat(5),
    gesture: `${character}朝剧情物体做一次精确手势。`.repeat(4),
    expression: `${character}的眼睛、眉峰、嘴角和下颌从戒备转为认出物体后的克制表情。`.repeat(5),
    gaze: `${character}把视线从同伴移到剧情物体，并保持最后的视线方向。`.repeat(4),
    breath: `${character}短暂屏息，稳定后随决定缓慢呼气。`.repeat(4),
    reaction: `${character}先承接前一动作，再改变距离和行动意图。`.repeat(5),
  });
  const segment = [1, 2, 3, 4].map(index => shot(index, {
    characters: ['Lin', 'Mei', 'Guard'],
    action: `Lin完成第${index}镜的独立物理动作，并改变画面中的状态。`,
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
  assert.match(prompt, /Lin完成第1镜的独立物理动作/);
  assert.match(prompt, /Lin完成第4镜的独立物理动作/);
  assert.match(prompt, /Lin：/);
  assert.match(prompt, /Mei：/);
  assert.match(prompt, /Guard：/);
});

test('directs a master-to-detail sequence with progressive coverage and a match insert', () => {
  const prompt = buildVideoSegmentPrompt([
    shot(1, { clipType: 'establishing', shotSize: 'wide shot', action: 'Lin进入档案室，在中央桌旁停下。' }),
    shot(2, { clipType: 'action', shotSize: 'medium shot', action: 'Lin伸手拿桌上的红包。' }),
    shot(3, { clipType: 'insert', shotSize: 'extreme close-up', action: '她用拇指掰开蜡封。' }),
  ], [], { duration: 12, language: 'en' });
  assert.match(prompt, /从空间主镜头切到.*进入更近的戏剧覆盖/);
  assert.match(prompt, /顺着手部、视线或物体运动切到.*精确细节插入镜头/);
  assert.match(prompt, /在切点匹配动作/);
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
    action: 'Lin抓紧湿绳，用力拉动后松开。',
    consequence: 'Visible result: the audience realizes the mechanism is safe.',
  })], [], { duration: 7, language: 'en' });
  assert.match(prompt, /Lin抓紧湿绳，用力拉动后松开/);
  assert.doesNotMatch(prompt, /Visible result|audience realizes|motion_physics|blocking_relation/);
});

test('uses the official three-field base format for first-and-last-frame generation', () => {
  const prompt = buildVideoSegmentPrompt([shot(1, { action: 'Lin转身走向门口。' })], [], {
    firstFrameUrl: 'https://example.com/first.jpg', duration: 8, language: 'en',
  });
  assert.match(prompt, /^参考图与目标视频的对齐方式/);
  assert.match(prompt, /integrated_multimodal_description:/);
  assert.match(prompt, /镜头从<Picture 1>开始/);
  assert.match(prompt, /准确到达<Picture 2>中的姿态与构图/);
  assert.doesNotMatch(prompt, /subject_definitions:|timeline_json|aid_h3_timeline/);
  assert.match(prompt, /overall_soundscape:/);
  assert.match(prompt, /non_diegetic_music: 无。/);
});
