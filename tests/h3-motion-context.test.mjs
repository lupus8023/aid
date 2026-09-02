import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyT8H3MotionContext,
  adaptH3PromptForMotionContinuation,
  h3MotionContextHeadSeconds,
  normalizeH3MotionContextRequest,
  shiftH3PromptTimecodes,
  shiftH3SpeechTurns,
} from '../lib/h3MotionContext.ts';

function promptFixture() {
  return {
    '1': { class_type: 'UNETLoader', inputs: {} },
    '2': { class_type: 'MiniMaxH3AudioConditioningT8', inputs: {
      clip: ['20', 0], video_vae: ['21', 0], audio_vae: ['22', 0], prompt: ['23', 0],
      width: ['24', 0], height: ['24', 1], length: ['25', 0], task_type: 'Hybrid',
      audio_mode: 'native', audio_denoise_strength: 1, add_source_as_reference: false,
      prompt_primary_audio_ordinal: 1, strict_prompt_tags: true, ref_image_size: 'match',
      reference_video_policy: 'official_2_to_15s', first_frame: ['26', 0], last_frame: ['27', 0],
      'ref_audios.ref_audio_0': ['28', 0],
    } },
    '3': { class_type: 'MiniMaxH3DualClockSamplerT8', inputs: { model: ['10', 0], av_latent: ['2', 1] } },
    '4': { class_type: 'BasicGuider', inputs: { model: ['3', 0], conditioning: ['2', 0] } },
    '5': { class_type: 'SamplerCustomAdvanced', inputs: { guider: ['4', 0], latent_image: ['2', 1] } },
    '6': { class_type: 'MiniMaxH3AVDecodeT8', inputs: { av_latent: ['5', 0], video_vae: ['21', 0], audio_vae: ['22', 0] } },
    '7': { class_type: 'VHS_VideoCombine', inputs: { images: ['6', 0], audio: ['6', 1] } },
    '10': { class_type: 'LoraLoaderBypassModelOnly', inputs: {} },
    '20': { class_type: 'CLIPLoader', inputs: {} },
    '21': { class_type: 'VAELoader', inputs: {} },
    '22': { class_type: 'VAELoader', inputs: {} },
    '23': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'prompt' } },
    '24': { class_type: 'ResolutionSelector', inputs: {} },
    '25': { class_type: 'PrimitiveFloat', inputs: { value: 5 } },
    '26': { class_type: 'LoadImage', inputs: {} },
    '27': { class_type: 'LoadImage', inputs: {} },
    '28': { class_type: 'LoadAudio', inputs: {} },
  };
}

test('shifts action and exact-dialogue timecodes by the reconstructed head', () => {
  const request = normalizeH3MotionContextRequest({ chainId: 'project-scene', segmentIndex: 2, contextFrames: 22 });
  const offset = h3MotionContextHeadSeconds(request);
  assert.equal(Number(offset.toFixed(6)), 0.916667);
  assert.equal(
    shiftH3PromptTimecodes('From 00:00.000 to 00:05.000. At 00:00.800, speak.', offset),
    'From 00:00.917 to 00:05.917. At 00:01.717, speak.',
  );
  assert.deepEqual(shiftH3SpeechTurns([{ start: 0.8, end: 2.2 }], offset), [{ start: 1.7166666666666668, end: 3.1166666666666667 }]);
});

test('segment zero prepares a retry-safe chain without shifting its authored timeline', () => {
  const request = normalizeH3MotionContextRequest({ chainId: 'project-scene', segmentIndex: 0, contextFrames: 22 });
  assert.equal(h3MotionContextHeadSeconds(request), 0);
  assert.equal(shiftH3PromptTimecodes('At 00:00.800', 0), 'At 00:00.800');
  const prompt = promptFixture();
  applyT8H3MotionContext(prompt, request, 5);
  assert.equal(prompt['2'].class_type, 'MiniMaxH3AudioConditioningT8');
  assert.equal(Object.values(prompt).some(node => node.class_type === 'MiniMaxH3LongVideoConditioningT8'), false);
  const save = Object.values(prompt).find(node => node.class_type === 'MiniMaxH3LongVideoContextSaveT8');
  assert.ok(save);
  assert.deepEqual(save.inputs.av_latent, ['5', 0]);
  assert.equal(save.inputs.chain_id, 'project-scene');
});

test('rewrites the normal storyboard first frame as a persistent continuation reference', () => {
  const prompt = adaptH3PromptForMotionContinuation(`subject_definitions:
<Picture 1> is the opening continuity frame for [Shot 1].
summary:
[locked-first-frame image-to-video]
retention_analysis:
<Picture 1> ([Shot 1] composition): opening anchor - preserve the scene.
detailed_description:
REFERENCE PRIORITY — LOCK to <Picture 1>; DO NOT REDRAW. <Picture 1> is the exact first frame at 00:00.000, not loose style inspiration.`);
  assert.match(prompt, /moving audiovisual context continuation/);
  assert.match(prompt, /persistent identity, wardrobe, scene, and composition reference/);
  assert.doesNotMatch(prompt, /exact first frame|opening anchor/);
});

test('rewires only the T8 conditioning and output seam', () => {
  const prompt = promptFixture();
  applyT8H3MotionContext(prompt, {
    chainId: 'project-scene', segmentIndex: 1, contextFrames: 22,
    continueAudio: true, isFinalSegment: false,
  }, 6);

  assert.equal(prompt['2'].class_type, 'MiniMaxH3LongVideoConditioningT8');
  assert.deepEqual(prompt['2'].inputs.model, ['10', 0]);
  assert.equal(prompt['2'].inputs.context_audio, 'video_and_audio');
  assert.deepEqual(prompt['2'].inputs.persistent_identity_image, ['26', 0]);
  assert.deepEqual(prompt['2'].inputs.first_frame, ['26', 0]);
  assert.equal(prompt['2'].inputs.task_type, 'Hybrid');
  assert.deepEqual(prompt['3'].inputs.model, ['2', 0]);
  assert.deepEqual(prompt['3'].inputs.av_latent, ['2', 2]);
  assert.deepEqual(prompt['4'].inputs.conditioning, ['2', 1]);
  assert.deepEqual(prompt['5'].inputs.latent_image, ['2', 2]);

  const planner = Object.entries(prompt).find(([, node]) => node.class_type === 'MiniMaxH3LongVideoPlannerT8');
  const loader = Object.entries(prompt).find(([, node]) => node.class_type === 'MiniMaxH3LongVideoContextLoadT8');
  const saver = Object.entries(prompt).find(([, node]) => node.class_type === 'MiniMaxH3LongVideoContextSaveT8');
  const trimmer = Object.entries(prompt).find(([, node]) => node.class_type === 'MiniMaxH3OutputTrimT8');
  assert.ok(planner && loader && saver && trimmer);
  assert.equal(planner[1].inputs.context_frames, 22);
  assert.deepEqual(saver[1].inputs.av_latent, ['5', 0]);
  assert.deepEqual(prompt['7'].inputs.images, [trimmer[0], 0]);
  assert.deepEqual(prompt['7'].inputs.audio, [trimmer[0], 1]);
});

test('rejects an unsafe graph shape before submission', () => {
  const prompt = promptFixture();
  prompt['6'].inputs.av_latent = ['other', 0];
  assert.throws(
    () => applyT8H3MotionContext(prompt, { chainId: 'x', segmentIndex: 1, contextFrames: 22 }, 5),
    /requires SamplerCustomAdvanced to feed/,
  );
});
