import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fitH3ReferenceAudioDurations,
  h3ConditioningTaskType,
  h3ReferenceAudioPolicy,
  h3VisualTaskType,
  injectLockedDriveAudio,
  taggedPrompt,
} from '../lib/comfyui.ts';

const TOTAL_BUDGET = 14.7;
const MINIMUM_DURATION = 2;

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

test('uses the exact dialogue stem as a light remix anchor and saves generated ambience', () => {
  const prompt = {
    6: {
      class_type: 'MiniMaxH3AudioConditioningT8',
      inputs: {
        task_type: 'Ref2VA',
        audio_mode: 'native',
        'ref_audios.ref_audio_0': ['20', 0],
      },
    },
    11: {
      class_type: 'MiniMaxH3AVDecodeT8',
      inputs: { samples: ['10', 0] },
    },
    12: {
      class_type: 'VHS_VideoCombine',
      inputs: { images: ['11', 0], audio: ['11', 1] },
    },
  };

  injectLockedDriveAudio(prompt, 'aid/exact-dialogue.wav', 'aid_multi_reference');
  const conditioning = prompt[6].inputs;
  const loadEntry = Object.entries(prompt).find(([, node]) => node.class_type === 'LoadAudio');
  assert.ok(loadEntry);
  assert.equal(loadEntry[1].inputs.audio, 'aid/exact-dialogue.wav');
  assert.deepEqual(conditioning.drive_audio, [loadEntry[0], 0]);
  assert.deepEqual(conditioning.final_audio, [loadEntry[0], 0]);
  assert.equal(conditioning.task_type, 'Ref2VA');
  assert.equal(conditioning.audio_mode, 'remix_source');
  assert.equal(conditioning.audio_denoise_strength, 0.2);
  assert.equal(conditioning.add_source_as_reference, true);
  assert.equal(conditioning.prompt_primary_audio_ordinal, 1);
  assert.equal(conditioning.strict_prompt_tags, true);
  assert.equal('ref_audios.ref_audio_0' in conditioning, false);
  assert.deepEqual(prompt[12].inputs.audio, ['11', 1]);
});

test('locked dialogue keeps Hybrid when explicit keyframes are connected', () => {
  const prompt = {
    6: {
      class_type: 'MiniMaxH3AudioConditioningT8',
      inputs: {
        task_type: 'FL2VA',
        first_frame: ['20', 0],
        last_frame: ['21', 0],
      },
    },
    12: {
      class_type: 'VHS_VideoCombine',
      inputs: { images: ['11', 0], audio: ['11', 1] },
    },
    22: {
      class_type: 'MiniMaxH3AVDecodeT8',
      inputs: { samples: ['10', 0] },
    },
  };

  injectLockedDriveAudio(prompt, 'aid/exact-dialogue.wav', 'aid_first_last');
  assert.equal(prompt[6].inputs.task_type, 'Hybrid');
});
