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
  injectH3ExactSpeechDrive,
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

test('generates a visually independent sound bed and rejects its vocal stem before mastering', () => {
  const prompt = {
    1: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'subject_definitions:\n\nretention_analysis:\nAudio references supply timbre only; ignore their words/timing.' }, _meta: { title: 'Input Text (Prompt)' } },
    2: { class_type: 'MiniMaxH3AudioConditioningT8', inputs: { clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0], prompt: ['1', 0], width: 768, height: 1344, length: 209, task_type: 'Ref2VA', audio_mode: 'native' } },
    3: { class_type: 'CLIPLoader', inputs: {} },
    4: { class_type: 'VAELoader', inputs: {} },
    5: { class_type: 'VAELoader', inputs: {} },
    6: { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: ['7', 0] } },
    7: { class_type: 'UNETLoader', inputs: {} },
    8: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['6', 0], av_latent: ['2', 1], steps: 8, shift_video: 12, shift_audio: 3 } },
    9: { class_type: 'BasicGuider', inputs: { model: ['8', 0], conditioning: ['2', 0] } },
    10: { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
    11: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['10', 0], guider: ['9', 0], sampler: ['8', 1], sigmas: ['8', 2], latent_image: ['2', 1] } },
    12: { class_type: 'MiniMaxH3AVDecodeT8', inputs: { av_latent: ['11', 0], video_vae: ['4', 0], audio_vae: ['5', 0] } },
    13: { class_type: 'VHS_VideoCombine', inputs: { images: ['12', 0], audio: ['12', 1] } },
  };
  assert.equal(injectH3ExactSpeechDrive(
    prompt,
    ['voice.wav'],
    ['Officer'],
    [{ speakerId: 'S2', character: 'Officer', exactLine: 'The gate is holding.' }],
    8.67,
    'en',
    '/models/faster-whisper-small',
    'Generate only continuous wind, cloth movement and footsteps. No human voice.',
  ), true);
  const nodes = Object.values(prompt);
  const backgroundConditioning = nodes.find(node => node._meta?.title === 'AID native ambience and Foley conditioning');
  const backgroundSetupEntry = Object.entries(prompt).find(([, node]) => node._meta?.title === 'AID ambience and Foley sampler');
  const backgroundSeparationEntry = Object.entries(prompt).find(([, node]) => node.class_type === 'AudioSeparation');
  const safeBackgroundEntry = Object.entries(prompt).find(([, node]) => node._meta?.title === 'AID non-vocal ambience and Foley bed');
  const masterEntry = Object.entries(prompt).find(([, node]) => node._meta?.title === 'AID exact dialogue plus full soundscape master');
  const acceptedSwitchEntry = Object.entries(prompt).find(([, node]) => node._meta?.title === 'AID accepted dialogue turn 1');
  const audioSwitchEntry = Object.entries(prompt).find(([, node]) => node._meta?.title === 'AID select accepted dialogue turn 1');
  const speechVerifiers = Object.entries(prompt).filter(([, node]) => node.class_type === 'MiniMaxH3SpeechVerifyT8');
  const master = masterEntry[1];
  assert.ok(!nodes.some(node => node.class_type === 'MiniMaxH3SourceAVPrepareT8'));
  assert.equal(backgroundConditioning.inputs.task_type, 'T2VA');
  assert.equal(backgroundConditioning.inputs.audio_mode, 'native');
  assert.equal('drive_audio' in backgroundConditioning.inputs, false);
  assert.equal('first_frame' in backgroundConditioning.inputs, false);
  assert.equal('last_frame' in backgroundConditioning.inputs, false);
  assert.equal(Object.keys(backgroundConditioning.inputs).some(key => key.startsWith('ref_images.')), false);
  assert.deepEqual(backgroundSetupEntry[1].inputs.av_latent, [
    Object.entries(prompt).find(([, node]) => node === backgroundConditioning)[0],
    1,
  ]);
  assert.deepEqual(backgroundSeparationEntry[1].inputs.audio, [
    Object.entries(prompt).find(([, node]) => node._meta?.title === 'AID ambience and Foley decode')[0],
    1,
  ]);
  assert.deepEqual(master.inputs.speech_accepted, [acceptedSwitchEntry[0], 0]);
  assert.equal(speechVerifiers.length, 2);
  assert.deepEqual(speechVerifiers.map(([, node]) => node.inputs.strict), [false, true]);
  assert.deepEqual(audioSwitchEntry[1].inputs.switch, [speechVerifiers[0][0], 4]);
  assert.deepEqual(audioSwitchEntry[1].inputs.on_false, [speechVerifiers[1][0], 0]);
  assert.deepEqual(audioSwitchEntry[1].inputs.on_true, [speechVerifiers[0][0], 0]);
  assert.deepEqual(master.inputs.ambience_audio, [safeBackgroundEntry[0], 0]);
  assert.equal(master.inputs.ambience_fit_policy, 'pad_or_trim');
  assert.deepEqual(prompt[13].inputs.audio, [
    masterEntry[0],
    0,
  ]);
});

test('builds H3 speech first and drives video with the verified exact track', () => {
  const prompt = {
    1: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'subject_definitions:\n<Audio 1> is the reusable Fish Audio timbre identity for S1; ignore sample words/timing. H3 speaks only scheduled dialogue.\n\nretention_analysis:\n<Audio 1>: timbre only; ignore source words/timing.\nAudio references supply timbre only; ignore their words/timing.' }, _meta: { title: 'Input Text (Prompt)' } },
    2: { class_type: 'MiniMaxH3AudioConditioningT8', inputs: { clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0], prompt: ['1', 0], task_type: 'Ref2VA', audio_mode: 'native', 'ref_audios.ref_audio_0': ['9', 0] } },
    3: { class_type: 'CLIPLoader', inputs: {} },
    4: { class_type: 'VAELoader', inputs: {} },
    5: { class_type: 'VAELoader', inputs: {} },
    6: { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: ['7', 0] } },
    7: { class_type: 'UNETLoader', inputs: {} },
    8: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['6', 0] } },
    9: { class_type: 'LoadAudio', inputs: { audio: 'legacy.wav' } },
  };
  assert.equal(injectH3ExactSpeechDrive(
    prompt,
    ['voice.wav'],
    ['Officer'],
    [{ speakerId: 'S2', character: 'Officer', exactLine: 'The gate is holding.' }],
    8,
    'en',
    '/models/faster-whisper-small',
  ), true);
  assert.equal(prompt[2].inputs.audio_mode, 'remix_source');
  assert.equal(prompt[2].inputs.task_type, 'Ref2VA');
  assert.ok(Array.isArray(prompt[2].inputs.drive_audio));
  assert.equal('ref_audios.ref_audio_0' in prompt[2].inputs, false);
  assert.match(prompt[1].inputs.value, /exact H3-generated dialogue track/);
  assert.doesNotMatch(prompt[1].inputs.value, /timbre only; ignore source words/);
  assert.ok(Object.values(prompt).some(node => node.class_type === 'MiniMaxH3SpeechVerifyT8' && node.inputs.verify_mode === 'trim_exact_target'));
  assert.ok(Object.values(prompt).some(node => (
    node.class_type === 'MiniMaxH3VoiceProfileT8'
    && node.inputs.speaker_id === 'S2'
  )), 'the sole uploaded voice must retain Subject 2 speaker identity instead of being renumbered to S1');
});

test('uses Hybrid exact-speech conditioning when continuity keeps first and last frames connected', () => {
  const prompt = {
    1: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'subject_definitions:\n\nretention_analysis:\nAudio references supply timbre only; ignore their words/timing.' }, _meta: { title: 'Input Text (Prompt)' } },
    2: { class_type: 'MiniMaxH3AudioConditioningT8', inputs: { clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0], prompt: ['1', 0], first_frame: ['10', 0], last_frame: ['11', 0], task_type: 'FL2VA', audio_mode: 'native' } },
    3: { class_type: 'CLIPLoader', inputs: {} },
    4: { class_type: 'VAELoader', inputs: {} },
    5: { class_type: 'VAELoader', inputs: {} },
    6: { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: ['7', 0] } },
    7: { class_type: 'UNETLoader', inputs: {} },
    8: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['6', 0] } },
    10: { class_type: 'LoadImage', inputs: { image: 'first.png' } },
    11: { class_type: 'LoadImage', inputs: { image: 'last.png' } },
  };
  assert.equal(injectH3ExactSpeechDrive(
    prompt,
    ['voice.wav'],
    ['Officer'],
    [{ speakerId: 'S2', character: 'Officer', exactLine: 'The gate is holding.' }],
    8,
    'en',
    '/models/faster-whisper-small',
  ), true);
  assert.equal(prompt[2].inputs.task_type, 'Hybrid');
  assert.ok(Array.isArray(prompt[2].inputs.drive_audio));
});

test('routes duplicate references for one speaking character through single-speaker conditioning', () => {
  const prompt = {
    1: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'subject_definitions:\n\nretention_analysis:\nAudio references supply timbre only; ignore their words/timing.' }, _meta: { title: 'Input Text (Prompt)' } },
    2: { class_type: 'MiniMaxH3AudioConditioningT8', inputs: { clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0], prompt: ['1', 0], task_type: 'I2VA', audio_mode: 'native' } },
    3: { class_type: 'CLIPLoader', inputs: {} },
    4: { class_type: 'VAELoader', inputs: {} },
    5: { class_type: 'VAELoader', inputs: {} },
    6: { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: ['7', 0] } },
    7: { class_type: 'UNETLoader', inputs: {} },
    8: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['6', 0] } },
  };
  assert.equal(injectH3ExactSpeechDrive(
    prompt,
    ['voice-a.wav', 'voice-b.wav'],
    ['Officer', 'Officer'],
    [
      { speakerId: 'S2', character: 'Officer', exactLine: 'The western gate is open.', start: 1.2, end: 3 },
      { speakerId: 'S2', character: 'Officer', exactLine: 'Move the patrol now.', start: 3.35, end: 5.2 },
    ],
    8,
    'en',
    '/models/faster-whisper-small',
  ), true);
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3VoiceProfileT8').length, 1);
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3SpeechConditioningT8').length, 2);
  assert.deepEqual(
    Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3SpeechPlanT8').map(node => node.inputs.text),
    ['The western gate is open.', 'Move the patrol now.'],
  );
  assert.deepEqual(
    Object.values(prompt).filter(node => node.class_type === 'EmptyAudio').map(node => node.inputs.duration),
    [1.2, 0.35],
  );
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3SpeechVerifyT8' && node.inputs.strict).length, 2);
  assert.ok(!Object.values(prompt).some(node => node.class_type === 'MiniMaxH3JointDialogueConditioningT8'));
});

test('renders different speakers independently before assembling their exact turns', () => {
  const prompt = {
    1: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'subject_definitions:\n\nretention_analysis:\nAudio references supply timbre only; ignore their words/timing.' }, _meta: { title: 'Input Text (Prompt)' } },
    2: { class_type: 'MiniMaxH3AudioConditioningT8', inputs: { clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0], prompt: ['1', 0], task_type: 'I2VA', audio_mode: 'native' } },
    3: { class_type: 'CLIPLoader', inputs: {} },
    4: { class_type: 'VAELoader', inputs: {} },
    5: { class_type: 'VAELoader', inputs: {} },
    6: { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: ['7', 0] } },
    7: { class_type: 'UNETLoader', inputs: {} },
    8: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['6', 0] } },
  };
  assert.equal(injectH3ExactSpeechDrive(
    prompt,
    ['a-luo.wav', 'mermaid.wav'],
    ['A-Luo', '人鱼公主'],
    [
      { speakerId: 'S3', character: 'A-Luo', exactLine: 'Let someone else carry one.' },
      { speakerId: 'S1', character: '人鱼公主', exactLine: 'Not while the palace depends on me.' },
    ],
    13,
    'en',
    '/models/faster-whisper-small',
  ), true);
  const profiles = Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3VoiceProfileT8');
  assert.deepEqual(profiles.map(node => node.inputs.speaker_id), ['S3', 'S1']);
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3SpeechPlanT8').length, 2);
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3SpeechVerifyT8').length, 4);
  assert.equal(Object.values(prompt).filter(node => node.class_type === 'ComfySwitchNode').length, 6);
  assert.ok(!Object.values(prompt).some(node => node.class_type === 'MiniMaxH3DialogueScriptT8'));
  assert.ok(!Object.values(prompt).some(node => node.class_type === 'MiniMaxH3JointDialogueConditioningT8'));
});

test('resolves legacy speaker-id collisions without dropping either character', () => {
  const prompt = {
    1: { class_type: 'PrimitiveStringMultiline', inputs: { value: 'subject_definitions:\n\nretention_analysis:\nAudio references supply timbre only; ignore their words/timing.' }, _meta: { title: 'Input Text (Prompt)' } },
    2: { class_type: 'MiniMaxH3AudioConditioningT8', inputs: { clip: ['3', 0], video_vae: ['4', 0], audio_vae: ['5', 0], prompt: ['1', 0], task_type: 'I2VA', audio_mode: 'native' } },
    3: { class_type: 'CLIPLoader', inputs: {} },
    4: { class_type: 'VAELoader', inputs: {} },
    5: { class_type: 'VAELoader', inputs: {} },
    6: { class_type: 'MiniMaxH3MemoryEfficientSageAttentionPatch', inputs: { model: ['7', 0] } },
    7: { class_type: 'UNETLoader', inputs: {} },
    8: { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['6', 0] } },
  };
  assert.equal(injectH3ExactSpeechDrive(
    prompt,
    ['chen.wav', 'gu.wav'],
    ['陈默', '顾寒'],
    [
      { speakerId: 'S39', character: '陈默', exactLine: '先关掉总闸。' },
      { speakerId: 'S39', character: '顾寒', exactLine: '我去检查备用线路。' },
    ],
    8,
    'zh',
    '/models/faster-whisper-small',
  ), true);
  const profiles = Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3VoiceProfileT8');
  assert.equal(new Set(profiles.map(node => node.inputs.speaker_id)).size, 2);
  assert.deepEqual(
    Object.values(prompt).filter(node => node.class_type === 'MiniMaxH3SpeechPlanT8').map(node => node.inputs.text),
    ['先关掉总闸。', '我去检查备用线路。'],
  );
});

test('fails closed for spoken segments instead of silently falling back to native H3 speech', () => {
  assert.equal(injectH3ExactSpeechDrive({}, [], [], [], 8, 'zh'), false);
  assert.throws(() => injectH3ExactSpeechDrive(
    {}, [], [], [{ speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。' }], 8, 'zh', '/models/faster-whisper-small',
  ), /缺少角色音色参考/);
  assert.throws(() => injectH3ExactSpeechDrive(
    {}, ['chen.wav'], ['陈默'], [{ speakerId: 'S1', character: '陈默', exactLine: '关掉总闸。' }], 8, 'zh', '',
  ), /缺少 faster-whisper-small/);
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
