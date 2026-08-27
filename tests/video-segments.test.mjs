import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateSegmentTimeline,
  cinematicEditKind,
  createVideoSegmentPlan,
  estimateVideoSegmentSeconds,
  H3_PROMPT_CONTRACT_VERSION,
  isCompletedVideoSegment,
  normalizeVideoSegmentPlan,
  persistedVideoClipCount,
  releaseUnsubmittedVideoGenerations,
  resolveVideoSegmentGroups,
  restoredStoryStep,
  suggestVideoSegments,
  validateVideoSegment,
  videoSegmentGenerationSignature,
} from '../lib/videoSegments.ts';
import {
  CONTINUITY_HANDOFF_LEAD_SECONDS,
  CONTINUITY_HEAD_TRIM_SECONDS,
} from '../lib/videoContinuity.ts';

const shot = (sceneNumber, extra = {}) => ({
  id: `scene-${sceneNumber}`,
  sceneNumber,
  description: `shot ${sceneNumber}`,
  prompt: '',
  characters: [],
  status: 'completed',
  imageUrl: `https://example.com/${sceneNumber}.jpg`,
  durationHint: 5,
  sequenceId: 'seq-1',
  locationId: 'loc-1',
  ...extra,
});

test('groups complete cinematic phrases while protecting hero shots', () => {
  const groups = suggestVideoSegments([
    shot(1, { durationHint: 3, clipType: 'establishing', shotSize: 'wide shot', montageRole: 'setup' }),
    shot(2, { durationHint: 3, clipType: 'action', shotSize: 'medium shot', montageRole: 'development' }),
    shot(3, { durationHint: 3, clipType: 'reaction', shotSize: 'close-up', montageRole: 'consequence' }),
    shot(4, { durationHint: 9, clipType: 'long_take', shotSize: 'wide shot' }),
    shot(5, { durationHint: 3, clipType: 'action', shotSize: 'medium shot' }),
    shot(6, { durationHint: 2, clipType: 'insert', shotSize: 'extreme close-up' }),
    shot(7, { durationHint: 3, clipType: 'reaction', shotSize: 'close-up' }),
    shot(8, { durationHint: 7, clipType: 'performance', shotSize: 'close-up' }),
    shot(9, { durationHint: 3, clipType: 'action', shotSize: 'medium shot' }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1, 2, 3], [4], [5, 6, 7], [8], [9]]);
  assert.ok(groups.every(group => estimateVideoSegmentSeconds(group) <= 15));
});

test('rebuilds a stale automatic fidelity plan with the cinematic editing contract', () => {
  const storyboards = [
    shot(1, { durationHint: 3, clipType: 'establishing', shotSize: 'wide shot' }),
    shot(2, { durationHint: 3, clipType: 'action', shotSize: 'medium shot' }),
    shot(3, { durationHint: 3, clipType: 'reaction', shotSize: 'close-up' }),
  ];
  const stale = createVideoSegmentPlan(storyboards, storyboards.map(item => [item]), 'auto');
  delete stale.planningContract;
  const normalized = normalizeVideoSegmentPlan(storyboards, stale);
  assert.deepEqual(normalized.groups, [['scene-1', 'scene-2', 'scene-3']]);
});

test('releases a fake generating segment that never received a durable task id', () => {
  const stuck = [
    shot(1, { videoStatus: 'generating', videoSegmentId: 'segment-stuck', videoSegmentStoryboardIds: ['scene-1', 'scene-2'] }),
    shot(2, { videoStatus: 'generating', videoSegmentId: 'segment-stuck' }),
  ];
  const released = releaseUnsubmittedVideoGenerations(stuck);
  assert.deepEqual(released.map(item => item.videoStatus), ['failed', 'failed']);
  assert.notEqual(released, stuck);
});

test('keeps all members locked when the segment leader has a recoverable task id', () => {
  const running = [
    shot(1, { videoStatus: 'generating', videoTaskId: 'comfyui:task-1', videoSegmentId: 'segment-running', videoSegmentStoryboardIds: ['scene-1', 'scene-2'] }),
    shot(2, { videoStatus: 'generating', videoSegmentId: 'segment-running' }),
  ];
  assert.equal(releaseUnsubmittedVideoGenerations(running), running);
});

test('uses one shot-reverse-shot unit for an adjacent question and answer', () => {
  const groups = suggestVideoSegments([
    shot(1, { durationHint: 10 }),
    shot(2, { durationHint: 5, characters: ['A'], dialogueUnitId: 'dlg-1', speech: [{ character: 'A', exactLine: 'Who opened the gate?', source: 'story_required' }] }),
    shot(3, { durationHint: 5, characters: ['B'], dialogueUnitId: 'dlg-1', speech: [{ character: 'B', exactLine: 'I opened it before the flood.', source: 'story_required' }] }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1], [2, 3]]);
  assert.equal(cinematicEditKind(groups[1][0], groups[1][1]), 'dialogue-reverse');
});

test('keeps causal shots editorially separate across sequence or location changes', () => {
  const groups = suggestVideoSegments([
    shot(1, { durationHint: 3 }),
    shot(2, { durationHint: 3 }),
    shot(3, { durationHint: 3, sequenceId: 'seq-2', locationId: 'loc-2' }),
    shot(4, { durationHint: 3, sequenceId: 'seq-3', locationId: 'loc-3' }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1], [2], [3], [4]]);
});

test('persists and restores a manual director segment plan', () => {
  const storyboards = [1, 2, 3, 4].map(number => shot(number, { durationHint: 3 }));
  const plan = createVideoSegmentPlan(storyboards, [storyboards.slice(0, 2), storyboards.slice(2)], 'manual');
  delete plan.planningContract;
  const restored = resolveVideoSegmentGroups(storyboards, JSON.parse(JSON.stringify(plan)));
  assert.equal(plan.version, 2);
  assert.equal(plan.source, 'manual');
  assert.deepEqual(restored.map(group => group.map(item => item.sceneNumber)), [[1, 2], [3, 4]]);
  assert.deepEqual(resolveVideoSegmentGroups([...storyboards].reverse(), plan).map(group => group.map(item => item.sceneNumber)), [[4], [3], [2], [1]]);
});

test('makes segment dialogue authoritative while storyboards remain visual references', () => {
  const storyboards = [
    shot(1, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: '第一部分说明。', source: 'story_required' }] }),
    shot(2, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: '第二部分结论。', source: 'story_required' }] }),
  ];
  const plan = createVideoSegmentPlan(storyboards, [storyboards]);
  assert.equal(plan.segments[0].speech.length, 1);
  assert.equal(plan.segments[0].speech[0].exactLine, '第一部分说明。第二部分结论。');
  const [resolved] = resolveVideoSegmentGroups(storyboards, plan);
  assert.equal(resolved[0].speech.length, 1);
  assert.deepEqual(resolved[1].speech, []);
  assert.equal(resolved[0].speech[0].sourceStoryboardId, 'scene-1');
});

test('keeps ordered multi-speaker dialogue at segment level with one block per identity', () => {
  const storyboards = [
    shot(1, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: '你确认入口安全吗？', source: 'story_required' }] }),
    shot(2, { characters: ['B'], speech: [{ character: 'B', voiceId: 'voice-b', exactLine: '我已经检查过两次。', source: 'story_required' }] }),
  ];
  const plan = createVideoSegmentPlan(storyboards, [storyboards]);
  assert.deepEqual(plan.segments[0].speech.map(line => line.character), ['A', 'B']);
  const [resolved] = resolveVideoSegmentGroups(storyboards, plan);
  assert.deepEqual(resolved.flatMap(item => item.speech).map(line => line.exactLine), ['你确认入口安全吗？', '我已经检查过两次。']);
});

test('splits an A-B-A recurrence into valid consecutive dialogue edit units', () => {
  const groups = suggestVideoSegments([
    shot(1, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-1', characters: ['A'], speech: [{ speakerId: 'S1', character: 'A', voiceId: 'voice-a', exactLine: '第一句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
    shot(2, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-1', characters: ['B'], speech: [{ speakerId: 'S2', character: 'B', voiceId: 'voice-b', exactLine: '第二句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
    shot(3, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-2', characters: ['A'], speech: [{ speakerId: 'S1', character: 'A', voiceId: 'voice-a', exactLine: '第三句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
    shot(4, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-2', characters: ['C'], speech: [{ speakerId: 'S3', character: 'C', voiceId: 'voice-c', exactLine: '第四句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1, 2], [3, 4]]);
  assert.equal(validateVideoSegment(groups[0]), undefined);
  assert.match(validateVideoSegment([shot(1, { characters: ['A'], imageUrl: 'x', dialogueLines: [{ character: 'A', text: '一。' }] }), shot(2, { characters: ['B'], imageUrl: 'x', dialogueLines: [{ character: 'B', text: '二。' }] }), shot(3, { characters: ['C'], imageUrl: 'x', dialogueLines: [{ character: 'C', text: '三。' }] }), shot(4, { characters: ['D'], imageUrl: 'x', dialogueLines: [{ character: 'D', text: '四。' }] })]), /最多绑定 3 个/);
});

test('rejects non-contiguous or oversized manual groups', () => {
  assert.match(validateVideoSegment([shot(1), shot(3)]), /连续分镜/);
  assert.match(validateVideoSegment([1, 2, 3, 4, 5].map(number => shot(number))), /最多选择 4/);
});

test('rejects a manual merge whose real beat budget exceeds fifteen seconds', () => {
  assert.match(validateVideoSegment([
    shot(1, { durationHint: 10 }),
    shot(2, { durationHint: 10 }),
    shot(3, { durationHint: 10 }),
  ]), /超过 H3 的 15 秒上限/);
});

test('timeline fills the entire H3 duration without gaps', () => {
  const timeline = allocateSegmentTimeline([shot(1), shot(2), shot(3), shot(4)], 12);
  assert.equal(timeline[0].start, 0);
  assert.equal(timeline.at(-1).end, 12);
  timeline.slice(1).forEach((item, index) => assert.equal(item.start, timeline[index].end));
});

test('segment duration reserves clean native-H3 lead-in and a complete final-word tail', () => {
  const segment = [
    shot(1, {
      characters: ['A'], clipType: 'action', durationHint: 5,
      speech: [{ speakerId: 'S1', character: 'A', voiceId: 'voice-a', exactLine: 'The Western Reef is still half a measure short.', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'user_exact' }],
      audioPlan: { backgroundHuman: 'none', environment: [], foley: [], music: 'none', silenceBefore: 0.1, silenceAfter: 0.4 },
    }),
    shot(2, {
      characters: ['B'], clipType: 'dialogue', durationHint: 4.5,
      speech: [{ speakerId: 'S2', character: 'B', voiceId: 'voice-b', exactLine: 'Princess, the Southern Bay channel is blocked.', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'user_exact' }],
      audioPlan: { backgroundHuman: 'none', environment: [], foley: [], music: 'none', silenceBefore: 0, silenceAfter: 0.3 },
    }),
  ];
  assert.equal(estimateVideoSegmentSeconds(segment), 9);
  assert.equal(validateVideoSegment(segment), undefined);
});

test('does not mistake legacy per-shot videos for a completed grouped segment', () => {
  const legacy = [
    shot(1, { videoStatus: 'completed', videoUrl: 'blob:legacy-1' }),
    shot(2, { videoStatus: 'completed', videoUrl: 'blob:legacy-2' }),
  ];
  assert.equal(isCompletedVideoSegment(legacy), false);

  const current = legacy.map((item, index) => ({
    ...item,
    videoUrl: index === 0 ? 'blob:segment' : undefined,
    videoSegmentId: 'segment-1',
    videoSegmentStoryboardIds: index === 0 ? ['scene-1', 'scene-2'] : undefined,
  }));
  assert.equal(isCompletedVideoSegment(current), true);
});

test('invalidates a generated segment when its image, action or dialogue changes', () => {
  const segment = [shot(1), shot(2)];
  const signature = videoSegmentGenerationSignature(segment);
  assert.match(signature, new RegExp(`^${H3_PROMPT_CONTRACT_VERSION}-`));
  const generated = segment.map((item, index) => ({
    ...item,
    videoStatus: 'completed',
    videoUrl: index === 0 ? 'blob:segment' : undefined,
    videoSegmentId: 'segment-1',
    videoSegmentStoryboardIds: index === 0 ? segment.map(shot => shot.id) : undefined,
    videoGenerationSignature: index === 0 ? signature : undefined,
  }));

  assert.equal(isCompletedVideoSegment(generated), true);
  assert.equal(isCompletedVideoSegment(generated.map((item, index) => index
    ? item
    : { ...item, imageUrl: 'https://example.com/revised.jpg' })), false);
  assert.equal(isCompletedVideoSegment(generated.map((item, index) => index
    ? item
    : { ...item, speech: [{ character: 'A', exactLine: '新的台词。' }] })), false);
  assert.equal(isCompletedVideoSegment(generated.map((item, index) => index
    ? item
    : { ...item, editBridge: 'The falling key match-cuts to the opening lock, proving the two events are causally linked.' })), false);
});

test('restores a saved H3 project directly to export after refresh', () => {
  const saved = [shot(1), shot(2)].map((item, index) => ({
    ...item,
    videoStatus: 'completed',
    videoSegmentId: 'segment-1',
    videoSegmentStoryboardIds: index === 0 ? ['scene-1', 'scene-2'] : undefined,
    videoCacheKey: index === 0 ? 'storyboard-video:project-1:scene-1' : undefined,
  }));
  assert.equal(restoredStoryStep(saved), 6);
  assert.equal(persistedVideoClipCount(saved), 1);
  assert.equal(restoredStoryStep(saved.map(item => ({ ...item, videoCacheKey: undefined }))), 5);
  assert.equal(restoredStoryStep(saved.map((item, index) => index ? item : { ...item, imageUrl: undefined })), 4);
});

test('keeps a newly merged manual plan in segment edit until that exact group is generated', () => {
  const individuallyGenerated = [shot(1), shot(2)].map((item, index) => ({
    ...item,
    videoStatus: 'completed',
    videoSegmentId: `old-segment-${index + 1}`,
    videoSegmentStoryboardIds: [item.id],
    videoCacheKey: `storyboard-video:project-1:${item.id}`,
  }));
  const plan = createVideoSegmentPlan(individuallyGenerated, [individuallyGenerated], 'manual');
  assert.equal(restoredStoryStep(individuallyGenerated, plan), 5);
});

test('uses a moving continuity handoff and trims the H3 restart', () => {
  assert.ok(CONTINUITY_HANDOFF_LEAD_SECONDS > CONTINUITY_HEAD_TRIM_SECONDS);
  assert.ok(CONTINUITY_HANDOFF_LEAD_SECONDS <= 0.3);
  assert.ok(CONTINUITY_HEAD_TRIM_SECONDS >= 0.12);
});
