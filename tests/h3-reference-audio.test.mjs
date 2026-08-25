import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  fitH3ReferenceAudioDurations,
  h3ConditioningTaskType,
  h3AlignedDurationSeconds,
  h3AlignedFrameCount,
  h3ReferenceAudioPolicy,
  h3VisualTaskType,
  injectH3NativeDialogue,
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
    /speaks\s*&&\s*settingsRef\.current\.fishAudioKey\s*&&\s*!voiceReferencesRef\.current\?\.\[character\.name\]/,
    'one-click production must only create a Fish reference when this character has no persisted reference yet',
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

test('uses reference-video mode whenever AID injects reference images', () => {
  assert.equal(h3VisualTaskType('aid_single_reference'), 'Ref2VA');
  assert.equal(h3VisualTaskType('aid_multi_reference'), 'Ref2VA');
  assert.equal(h3VisualTaskType('aid_first_last'), 'FL2VA');
});

test('uses hybrid mode for first/last-frame continuity with voice references', () => {
  assert.equal(h3ConditioningTaskType('FL2VA', 1), 'Hybrid');
  assert.equal(h3ConditioningTaskType('FL2VA', 0), 'FL2VA');
  assert.equal(h3ConditioningTaskType('Ref2VA', 2), 'Ref2VA');
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
