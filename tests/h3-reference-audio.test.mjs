import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyH3Fl2vaProfile,
  fitH3ReferenceAudioDurations,
  H3_DASIWA_4TURBO_PROFILE,
  H3_FL2VA_BALANCED_PROFILE,
  h3ConditioningTaskType,
  h3AlignedDurationSeconds,
  h3AlignedFrameCount,
  h3ReferenceAudioPolicy,
  h3VisualTaskType,
  injectReferenceImages,
  injectH3NativeDialogue,
  sanitizeSubmittedH3Prompt,
  selectComfyUIVideoOutput,
  comfyUIQueueContainsPrompt,
  taggedPrompt,
} from '../lib/comfyui.ts';
import {
  currentVoiceReferences,
  isCurrentVoiceReference,
  voiceReferencePublicId,
  voiceReferenceSample,
} from '../lib/voiceReference.ts';

const TOTAL_BUDGET = 14.7;
const MINIMUM_DURATION = 2;

test('aligns requested duration to the H3 temporal block used by the remote workflow', () => {
  assert.equal(h3AlignedFrameCount(12), 294);
  assert.equal(h3AlignedDurationSeconds(12), 12.25);
  assert.equal(h3AlignedFrameCount(13), 328);
  assert.equal(Number(h3AlignedDurationSeconds(13).toFixed(6)), 13.666667);
});

test('Story uses Fish once per character as timbre reference and never as final dialogue audio', () => {
  const storyPage = readFileSync(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  const videoRoute = readFileSync(new URL('../app/api/generate-video/route.ts', import.meta.url), 'utf8');
  const comfy = readFileSync(new URL('../lib/comfyui.ts', import.meta.url), 'utf8');
  assert.match(storyPage, /\/api\/generate-voice-reference/);
  assert.match(
    storyPage,
    /speaks\s*&&\s*autoVideoProvider\s*!==\s*'fal'\s*&&\s*settingsRef\.current\.fishAudioKey\s*&&\s*!voiceReferencesRef\.current\?\.\[character\.name\]/,
    'one-click production must create a missing Fish timbre reference only for providers that accept audio input',
  );
  assert.match(
    storyPage,
    /for \(const character of speakingCharacters\)[\s\S]*?!voiceReferencesRef\.current\?\.\[character\][\s\S]*?handleGenerateVoiceReference\(character, \{ throwOnError: true \}\)/,
    'manual segment generation must lazily create the same one-time timbre reference for older projects',
  );
  assert.doesNotMatch(storyPage, /\/api\/generate-audio/);
  assert.doesNotMatch(videoRoute, /lockDialogueAudio|driveAudio/);
  assert.doesNotMatch(comfy, /injectLockedDriveAudio|exact full-duration dialogue|MiniMaxH3AudioMixT8/);
});

test('Fish timbre references use natural calibration speech instead of sustained filler vowels', () => {
  assert.match(voiceReferenceSample('en'), /natural, steady voice/);
  assert.match(voiceReferenceSample('zh'), /自然、清楚、平稳/);
  assert.doesNotMatch(voiceReferenceSample('en'), /Mmm|ah—oh/i);
  assert.doesNotMatch(voiceReferenceSample('zh'), /^嗯|啊——哦/);
});

test('invalidates old vowel references while retaining timbre-v3 references', () => {
  const fresh = `https://example.test/aid-voice-refs/${voiceReferencePublicId('Tide Officer')}.mp3`;
  const old = 'https://example.test/aid-voice-refs/voice-ref-Tide-Officer-123.mp3';
  assert.equal(isCurrentVoiceReference(fresh), true);
  assert.equal(isCurrentVoiceReference(old), false);
  assert.deepEqual(currentVoiceReferences({ Officer: fresh, Legacy: old }), { Officer: fresh });
});

function nativePrompt(text, taskType = 'Ref2VA') {
  return {
    1: { class_type: 'PrimitiveStringMultiline', inputs: { value: text }, _meta: { title: 'Input Text (Prompt)' } },
    2: { class_type: 'MiniMaxH3AudioConditioningT8', inputs: { clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0], prompt: ['1', 0], task_type: taskType, audio_mode: 'native' } },
    3: { class_type: 'CLIPLoader', inputs: {} },
    4: { class_type: 'VAELoader', inputs: {} },
    5: { class_type: 'VAELoader', inputs: {} },
    6: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['7', 0] } },
    7: { class_type: 'UNETLoader', inputs: {} },
    8: { class_type: 'MiniMaxH3AVDecodeT8', inputs: { av_latent: ['6', 0], video_vae: ['4', 0], audio_vae: ['5', 0] } },
    9: { class_type: 'VHS_VideoCombine', inputs: { images: ['8', 0], audio: ['8', 1] } },
  };
}

function acceleratedPrompt() {
  return {
    20: { class_type: 'UNETLoader', inputs: { unet_name: 'legacy.safetensors', weight_dtype: 'default' } },
    21: { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: ['20', 0] } },
    22: { class_type: 'LoraLoaderBypassModelOnly', inputs: { model: ['21', 0], lora_name: 'legacy.safetensors', strength_model: 1 } },
    23: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['22', 0], steps: 8, shift_video: 12, shift_audio: 3 } },
    24: { class_type: 'CLIPLoader', inputs: { clip_name: 'legacy.safetensors', type: 'minimax', device: 'default' } },
  };
}

test('locks I2VA and FL2VA to the matched 768p eight-step Sage stack', () => {
  for (const variant of ['aid_single_reference', 'aid_first_last']) {
    const prompt = acceleratedPrompt();
    const result = applyH3Fl2vaProfile(prompt, variant, 'balanced8');
    assert.equal(result.active, true);
    assert.equal(result.sageAttention, true);
    assert.equal(prompt[20].inputs.unet_name, H3_FL2VA_BALANCED_PROFILE.diffusionModel);
    assert.equal(prompt[24].inputs.clip_name, H3_FL2VA_BALANCED_PROFILE.textEncoder);
    assert.equal(prompt[22].inputs.lora_name, H3_FL2VA_BALANCED_PROFILE.lora);
    assert.equal(prompt[23].inputs.steps, 8);
    assert.equal(prompt[23].inputs.shift_video, 6);
    assert.equal(prompt[23].inputs.shift_audio, 3);
  }
});

test('leaves Ref2VA and explicit legacy rollback workflows untouched', () => {
  const referencePrompt = acceleratedPrompt();
  assert.equal(applyH3Fl2vaProfile(referencePrompt, 'aid_multi_reference').active, false);
  assert.equal(referencePrompt[20].inputs.unet_name, 'legacy.safetensors');
  const legacyPrompt = acceleratedPrompt();
  assert.equal(applyH3Fl2vaProfile(legacyPrompt, 'aid_first_last', 'legacy').active, false);
  assert.equal(legacyPrompt[23].inputs.shift_video, 12);
});

test('locks I2VA and FL2VA to the production-tested DaSiWa four-step stack', () => {
  for (const variant of ['aid_single_reference', 'aid_first_last']) {
    const prompt = acceleratedPrompt();
    const result = applyH3Fl2vaProfile(prompt, variant, 'dasiwa4');
    assert.equal(result.active, true);
    assert.equal(result.approximateCache, false);
    assert.equal(prompt[20].inputs.unet_name, H3_DASIWA_4TURBO_PROFILE.diffusionModel);
    assert.equal(prompt[24].inputs.clip_name, H3_DASIWA_4TURBO_PROFILE.textEncoder);
    assert.equal(prompt[22].inputs.lora_name, H3_DASIWA_4TURBO_PROFILE.lora);
    assert.equal(prompt[23].inputs.steps, 4);
    assert.equal(prompt[23].inputs.shift_video, 12);
    assert.equal(prompt[23].inputs.shift_audio, 3);
    assert.equal(prompt[23].inputs.sampler_name, 'dual_clock_euler');
    assert.equal(prompt[23].inputs.scheduler, 'simple');
  }
  const referencePrompt = acceleratedPrompt();
  assert.equal(applyH3Fl2vaProfile(referencePrompt, 'aid_multi_reference', 'dasiwa4').active, false);
  assert.equal(referencePrompt[20].inputs.unet_name, 'legacy.safetensors');
});

test('fails closed if Sage is missing from the FL2VA production chain', () => {
  const prompt = acceleratedPrompt();
  delete prompt[21];
  assert.throws(
    () => applyH3Fl2vaProfile(prompt, 'aid_first_last'),
    /MiniMaxH3MemoryEfficientSageAttentionPatch/,
  );
});

const englishPrompt = `subject_definitions:
<Audio 1> provides only the voice timbre for Officer.

summary:
One native audiovisual generation.

retention_analysis:
Preserve the declared voice binding.

detailed_description:
At 00:00.800, Officer says once: <d>[English] The gate is holding.</d>.

overall_soundscape:
Wind and footsteps. No other intelligible voice.

non_diegetic_music:
No music is present.`;

test('uses one native H3 pass and delivers its synchronized audio unchanged', () => {
  const prompt = nativePrompt(englishPrompt);
  assert.equal(injectH3NativeDialogue(
    prompt,
    ['voice.wav'],
    ['Officer'],
    [{ speakerId: 'S2', character: 'Officer', exactLine: 'The gate is holding.', start: 0.8, end: 4 }],
    8.67,
    'en',
  ), true);
  const nodes = Object.values(prompt);
  assert.equal(prompt[2].inputs.audio_mode, 'native');
  assert.equal(prompt[2].inputs.audio_denoise_strength, 1);
  assert.equal(prompt[2].inputs.task_type, 'Ref2VA');
  assert.equal('drive_audio' in prompt[2].inputs, false);
  assert.ok(Array.isArray(prompt[2].inputs['ref_audios.ref_audio_0']));
  assert.equal(nodes.filter(node => node.class_type === 'MiniMaxH3DualClockSamplerT8').length, 1);
  assert.equal(nodes.filter(node => node.class_type === 'MiniMaxH3AVDecodeT8').length, 1);
  assert.equal(nodes.filter(node => /MiniMaxH3Speech|DialogueSafeMaster|AudioSeparation/.test(node.class_type)).length, 0);
  assert.deepEqual(prompt[9].inputs.audio, ['8', 1]);
});

test('uses Hybrid native conditioning for first/last-frame continuity with a voice reference', () => {
  const prompt = nativePrompt(englishPrompt, 'FL2VA');
  prompt[2].inputs.first_frame = ['10', 0];
  prompt[2].inputs.last_frame = ['11', 0];
  assert.equal(injectH3NativeDialogue(
    prompt,
    ['voice.wav'],
    ['Officer'],
    [{ character: 'Officer', exactLine: 'The gate is holding.', start: 0.8, end: 4 }],
    8,
    'en',
  ), true);
  assert.equal(prompt[2].inputs.task_type, 'Hybrid');
  assert.equal(prompt[2].inputs.audio_mode, 'native');
});

test('fails closed when the one-pass prompt and screenplay dialogue differ', () => {
  assert.equal(injectH3NativeDialogue({}, [], [], [], 8, 'zh'), false);
  assert.throws(() => injectH3NativeDialogue(
    {}, [], [], [{ speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。', start: 0.8, end: 2.8 }], 8, 'zh',
  ), /缺少角色音色参考/);
  assert.throws(() => injectH3NativeDialogue(
    {}, ['chen.wav'], ['陈默'], [{ speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。' }], 8, 'zh',
  ), /缺少有效的开始\/结束时间/);
  assert.throws(() => injectH3NativeDialogue(
    {}, ['chen.wav'], ['陈默'], [
      { speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。', start: 0.8, end: 2.8 },
      { speakerId: 'S2', character: '', exactLine: '我去检查。', start: 3.15, end: 4.8 },
    ], 8, 'zh',
  ), /阻止静默丢弃/);
  assert.throws(() => injectH3NativeDialogue(
    {}, ['chen.wav'], ['陈默'], [{ speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。', start: 0.8, end: 0.8005 }], 8, 'zh',
  ), /短于 1 毫秒/);
  assert.throws(() => injectH3NativeDialogue(
    {}, ['chen.wav'], ['陈默'], [{ speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。', start: 0.8, end: 2.8 }], Number.NaN, 'zh',
  ), /缺少有效的母带时长/);
  assert.throws(() => injectH3NativeDialogue(
    {}, ['chen.wav'], ['陈默'], [{ speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。', start: 7.2, end: 8.4 }], 8, 'zh',
  ), /超过片段母带/);
  assert.throws(() => injectH3NativeDialogue(
    {}, ['chen.wav'], ['陈默'], [
      { speakerId: 'S1', character: '陈默', exactLine: '先关总闸。', start: 0.8, end: 2.8 },
      { speakerId: 'S1', character: '陈默', exactLine: '再查线路。', start: 2.4, end: 4.2 },
    ], 8, 'zh',
  ), /时间重叠或顺序错误/);
  assert.throws(() => injectH3NativeDialogue(
    nativePrompt(englishPrompt.replace('The gate is holding.', 'A different line.')),
    ['voice.wav'], ['Officer'],
    [{ character: 'Officer', exactLine: 'The gate is holding.', start: 0.8, end: 4 }], 8, 'en',
  ), /对白与剧本逐字文本/);
});

function assertValidAllocation(sourceDurations, expectedDurations) {
  const actual = fitH3ReferenceAudioDurations(sourceDurations);
  assert.equal(actual.length, sourceDurations.length);
  actual.forEach((duration, index) => {
    assert.ok(duration >= MINIMUM_DURATION, `audio ${index + 1} fell below the H3 minimum`);
    assert.ok(duration <= Math.max(sourceDurations[index], MINIMUM_DURATION), `audio ${index + 1} exceeded its padded source duration`);
  });
  assert.ok(actual.reduce((total, duration) => total + duration, 0) <= TOTAL_BUDGET + 0.0001);
  if (expectedDurations) {
    assert.deepEqual(actual.map(duration => Number(duration.toFixed(3))), expectedDurations);
  }
}

test('keeps reference audio unchanged when already within the H3 total limit', () => {
  assertValidAllocation([3, 4], [3, 4]);
});

test('trims one overlong reference below the H3 total limit', () => {
  assertValidAllocation([17.2], [14.7]);
});

test('fairly fits two speaking characters within the H3 total limit', () => {
  assertValidAllocation([8.1, 9.1], [7.35, 7.35]);
});

test('fairly fits three speaking characters within the H3 total limit', () => {
  assertValidAllocation([5.8, 5.8, 5.9], [4.9, 4.9, 4.9]);
});

test('preserves a short valid reference while distributing the remaining budget', () => {
  assertValidAllocation([2.2, 12, 12], [2.2, 6.25, 6.25]);
});

test('pads an exact short dialogue reference to the H3 minimum', () => {
  assert.deepEqual(fitH3ReferenceAudioDurations([0.9]), [2]);
});

test('keeps voice references in native mode without requiring drive audio', () => {
  assert.deepEqual(h3ReferenceAudioPolicy(2), {
    audio_mode: 'native',
    add_source_as_reference: false,
    prompt_primary_audio_ordinal: 1,
  });
  assert.equal(h3ReferenceAudioPolicy(0).prompt_primary_audio_ordinal, 0);
});

test('uses a true first-frame I2VA mode for one storyboard', () => {
  assert.equal(h3VisualTaskType('aid_single_reference'), 'I2VA');
  assert.equal(h3VisualTaskType('aid_multi_reference'), 'Ref2VA');
  assert.equal(h3VisualTaskType('aid_first_last'), 'FL2VA');
});

test('uses hybrid mode when a locked frame also carries voice references', () => {
  assert.equal(h3ConditioningTaskType('I2VA', 1), 'Hybrid');
  assert.equal(h3ConditioningTaskType('I2VA', 0), 'I2VA');
  assert.equal(h3ConditioningTaskType('FL2VA', 1), 'Hybrid');
  assert.equal(h3ConditioningTaskType('FL2VA', 0), 'FL2VA');
  assert.equal(h3ConditioningTaskType('Ref2VA', 2), 'Ref2VA');
});

test('wires a single storyboard into first_frame instead of ref_images', () => {
  const prompt = nativePrompt(englishPrompt);
  prompt[2].inputs['ref_images.ref_image_0'] = ['10', 0];
  injectReferenceImages(prompt, 'aid_single_reference', ['locked-frame.png']);
  assert.equal(prompt[2].inputs.task_type, 'I2VA');
  assert.ok(Array.isArray(prompt[2].inputs.first_frame));
  assert.equal(Object.keys(prompt[2].inputs).some(key => key.startsWith('ref_images.ref_image_')), false);
  const loader = prompt[prompt[2].inputs.first_frame[0]];
  assert.equal(loader.class_type, 'LoadImage');
  assert.equal(loader.inputs.image, 'locked-frame.png');
});

test('keeps the I2VA first frame while native voice conditioning becomes Hybrid', () => {
  const prompt = nativePrompt(englishPrompt);
  injectReferenceImages(prompt, 'aid_single_reference', ['locked-frame.png']);
  assert.equal(injectH3NativeDialogue(
    prompt,
    ['voice.wav'],
    ['Officer'],
    [{ character: 'Officer', exactLine: 'The gate is holding.', start: 0.8, end: 4 }],
    8,
    'en',
  ), true);
  assert.equal(prompt[2].inputs.task_type, 'Hybrid');
  assert.ok(Array.isArray(prompt[2].inputs.first_frame));
});

test('never turns native audio into permission to invent speech or music', () => {
  const silent = taggedPrompt('AUDIO: no approved dialogue.', 'aid_single_reference', 0, 0);
  assert.match(silent, /With no scripted line/);
  assert.match(silent, /non-speaking performance/);

  const voiced = taggedPrompt('APPROVED DIALOGUE: A: "你好"', 'aid_multi_reference', 1, 1, ['A']);
  assert.match(voiced, /Voice-to-character binding/);
  assert.match(voiced, /sole spoken wording/);
});

test('keeps an official structured H3 prompt free of a second appended contract', () => {
  const official = `subject_definitions:\n<Picture 1> is a shot reference.\n\nsummary:\n[reference generation] One shot.\n\nretention_analysis:\n<Picture 1>: fully_preserved - composition.\n\ndetailed_description:\n[Shot 1] A person walks.\n\noverall_soundscape:\nFootsteps.\n\nnon_diegetic_music:\nN/A`;
  assert.equal(taggedPrompt(official, 'aid_single_reference', 0, 0), official);
});

test('removes the Chinese visible cue at the final submission boundary without changing dialogue', () => {
  const official = `subject_definitions:\n<Picture 1> 是镜头参考。\n\nsummary:\n一个镜头。\n\nretention_analysis:\n保留主体。\n\ndetailed_description:\n[Shot 1] 画面中可见熊猫博士。可见物体为线雕面膜。熊猫博士说：<d>[Chinese] 这是肉眼可见的变化。<\/d>\n\noverall_soundscape:\n场景底噪。\n\nnon_diegetic_music:\nN/A`;
  const submitted = taggedPrompt(official, 'aid_single_reference', 0, 0);
  assert.doesNotMatch(submitted.replace(/<d>[\s\S]*?<\/d>/g, ''), /可见/);
  assert.match(submitted, /镜头内物体包括线雕面膜/);
  assert.match(submitted, /<d>\[Chinese] 这是肉眼可见的变化。<\/d>/);
});

test('removes stop-speaking prose at submission while preserving exact dialogue', () => {
  const prompt = `detailed_description:\nAt 00:00.800, <Subject 1> (S1) says: <d>[Chinese] 说完最后一个字就闭嘴。<\/d> 说完最后一个字就闭嘴。 The mouth closes naturally when the final word is complete.\n\noverall_soundscape:\nRoom tone.\n\nnon_diegetic_music:\nN/A`;
  const submitted = sanitizeSubmittedH3Prompt(prompt);
  assert.match(submitted, /<d>\[Chinese] 说完最后一个字就闭嘴。<\/d>/);
  const outsideDialogue = submitted.replace(/<d>[\s\S]*?<\/d>/g, '');
  assert.doesNotMatch(outsideDialogue, /说完最后一个字|闭嘴|mouth closes|final word/i);
});

test('preserves Picture 2 in official first/last prompts even without auxiliary images', () => {
  const official = `参考图片与目标视频的时间对齐——Picture 1 对应 0.00 秒；Picture 2 对应 9.00 秒。\n\nintegrated_multimodal_description: <Picture 1> 是起点，<Picture 2> 是终点。\n\noverall_soundscape: 场景底噪。\n\nnon_diegetic_music: 没有音乐。`;
  const tagged = taggedPrompt(official, 'aid_first_last', 0, 1, ['Dr. Pan']);
  assert.equal((tagged.match(/Picture 2/g) || []).length, 2);
  assert.doesNotMatch(tagged, /the prior generated output|上一段生成结果/);
});

test('prefers the final muxed audio MP4 over the temporary silent MP4', () => {
  assert.deepEqual(selectComfyUIVideoOutput({
    270: {
      gifs: [
        { filename: 'segment_00001.mp4', subfolder: 'aid/test', type: 'output' },
        { filename: 'segment_00001-audio.mp4', subfolder: 'aid/test', type: 'output' },
      ],
    },
  }), {
    filename: 'segment_00001-audio.mp4',
    subfolder: 'aid/test',
    type: 'output',
  });
});

test('distinguishes a real queued ComfyUI prompt from a stale persisted task id', () => {
  const queue = {
    queue_running: [[7, 'prompt-running', {}, {}, []]],
    queue_pending: [[8, 'prompt-pending', {}, {}, []]],
  };
  assert.equal(comfyUIQueueContainsPrompt(queue, 'prompt-running'), true);
  assert.equal(comfyUIQueueContainsPrompt(queue, 'prompt-pending'), true);
  assert.equal(comfyUIQueueContainsPrompt(queue, 'prompt-missing'), false);
  assert.equal(comfyUIQueueContainsPrompt({}, 'prompt-running'), false);
});
