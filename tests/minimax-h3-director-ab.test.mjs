import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDirectorPrompt, h3FrameCount } from '../scripts/minimax-h3-director-ab.mjs';

const definitions = {
  MiniMaxH3Director: {},
  MiniMaxH3DirectorRefine: {
    input: { required: { latent_upscale_model: [['put_latent_upscale_models_here']] } },
  },
  MiniMaxH3DirectorGroupImageToVideo: {},
  MiniMaxH3DirectorGroupsCombine: {},
  MiniMaxH3MemoryEfficientSageAttentionPatch: {},
  LoraLoaderModelOnly: {},
  BasicScheduler: {},
  PreviewAny: {},
};

test('aligns Director durations to the H3 17k+5 frame grid', () => {
  assert.equal(h3FrameCount(5), 124);
  assert.equal(h3FrameCount(8), 192);
  assert.equal(h3FrameCount(15), 362);
});

test('builds a three-segment continuity prompt with one real first frame', () => {
  const built = buildDirectorPrompt({
    caseName: 'continuity',
    remoteImage: 'aid/test/frame.png',
    promptText: 'subject_definitions:\n<Subject 1> is Nana in <Picture 1>.\ndetailed_description:\nThe shot follows <Picture 1> as its composition reference.',
    outputPrefix: 'aid/test/continuity',
    definitions,
    seed: 7,
  });
  assert.equal(built.groups.length, 3);
  assert.equal(built.totalFrames, 372);
  assert.deepEqual(built.prompt['20'].inputs.first_frame, ['10', 0]);
  assert.equal('first_frame' in built.prompt['21'].inputs, false);
  assert.equal('first_frame' in built.prompt['22'].inputs, false);
  assert.equal(built.prompt['30'].inputs.steps, 4);
  const timeline = JSON.parse(built.prompt['30'].inputs.timeline_data);
  assert.equal(timeline.output.continuityEnabled, true);
  assert.equal(timeline.output.continuityOverlapFrames, 22);
  assert.deepEqual(built.prompt['33'].inputs.source, ['30', 5]);
});

test('builds a clean-model 1344x768 second-sample branch', () => {
  const built = buildDirectorPrompt({
    caseName: 'refine',
    remoteImage: 'aid/test/frame.png',
    promptText: 'A natural observational shot.',
    outputPrefix: 'aid/test/refine',
    definitions,
  });
  assert.deepEqual(built.prompt['30'].inputs.refine, ['41', 0]);
  assert.equal(built.prompt['41'].inputs.upscale_method, 'lanczos');
  assert.equal(built.prompt['41'].inputs.width, 1344);
  assert.equal(built.prompt['41'].inputs.height, 768);
  assert.deepEqual(built.prompt['41'].inputs.refine_model, ['2', 0]);
  assert.deepEqual(built.prompt['41'].inputs.sigmas, ['40', 0]);
});
