import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lockStoryboardVoiceIds } from '../lib/voiceCasting.ts';

import {
  allocateSegmentTimeline,
  cinematicEditKind,
  createVideoSegmentPlan,
  estimateVideoSegmentSeconds,
  H3_PROMPT_CONTRACT_VERSION,
  isCompletedVideoSegment,
  isCompletedPlannedVideoSegment,
  isValidVideoSegmentPlan,
  normalizeVideoSegmentPlan,
  persistedVideoClipCount,
  releaseUnsubmittedVideoGenerations,
  resolveVideoSegmentGroups,
  splitPlannedVideoSegment,
  refreshPlannedVideoSegment,
  restoredStoryStep,
  suggestVideoSegments,
  validateVideoSegment,
  videoSegmentGenerationSignature,
} from '../lib/videoSegments.ts';
import {
  CONTINUITY_HANDOFF_LEAD_SECONDS,
  CONTINUITY_HEAD_TRIM_SECONDS,
  previousSegmentTailSource,
  hasLegacyAutomaticContinuity,
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

test('manual segment materialization rebinds stale alias speech without changing the edit plan', () => {
  const boards = [shot(1, { characters: ['贵妃'], speech: [{ character: '贵妃', speakerId: 'S1', exactLine: '你先试。', voiceId: 'old', source: 'story_required' }] })];
  const plan = createVideoSegmentPlan(boards, [boards], 'manual');
  plan.segments[0].speech[0].voiceId = undefined;
  const before = structuredClone(plan);
  const rawGroups = resolveVideoSegmentGroups(boards, plan, 'zh');
  assert.match(validateVideoSegment(rawGroups[0], 'zh'), /尚未锁定音色/);
  const rebound = rawGroups.map(group => lockStoryboardVoiceIds(group, [{ name: '唐朝贵妃', aliases: ['贵妃', '沈贵妃'], voiceId: 'library-locked', voiceLocked: true }]));
  assert.equal(validateVideoSegment(rebound[0], 'zh'), undefined);
  assert.equal(rebound[0][0].speech[0].exactLine, '你先试。');
  assert.equal(rebound[0][0].speech[0].voiceId, 'library-locked');
  assert.deepEqual(plan, before);
});

test('shared/empty location metadata and legacy continuity never opt into tail-frame replacement', () => {
  const previous = shot(5, { videoUrl: 'bedroom.mp4', videoStatus: 'completed' });
  for (const current of [shot(6), shot(6, { continuousFromPrev: true, continuityFrom: previous.id }), shot(6, { sequenceId: undefined, locationId: undefined })]) {
    assert.equal(previousSegmentTailSource([previous, current], current), undefined);
  }
});

test('tail-frame opt-in requires known matching location and an immediately adjacent completed segment', () => {
  const previous = shot(5, { videoUrl: 'bedroom.mp4', videoStatus: 'completed' });
  const current = shot(6, { videoStartMode: 'previous-segment-tail' });
  assert.equal(previousSegmentTailSource([previous, current], current), previous);
  for (const extra of [{ locationId: 'stairs' }, { locationId: '' }, { sequenceId: '' }]) {
    assert.equal(previousSegmentTailSource([previous, { ...current, ...extra }], { ...current, ...extra }), undefined);
  }
  assert.equal(previousSegmentTailSource([{ ...previous, transition: 'fade' }, current], current), undefined);
  assert.equal(previousSegmentTailSource([previous, shot(6), shot(7, { videoStartMode: 'previous-segment-tail' })], shot(7, { videoStartMode: 'previous-segment-tail' })), undefined);
});

test('a multi-shot predecessor resolves only its own completed segment leader', () => {
  const owner = shot(4, { videoUrl: 'segment.mp4', videoStatus: 'completed', videoSegmentId: 'prev', videoSegmentStoryboardIds: ['scene-4', 'scene-5'] });
  const previous = shot(5, { videoStatus: 'completed', videoSegmentId: 'prev' });
  const current = shot(6, { videoStartMode: 'previous-segment-tail' });
  assert.equal(previousSegmentTailSource([owner, previous, current], current), owner);
  assert.equal(previousSegmentTailSource([{ ...owner, videoStatus: 'failed' }, previous, current], current), undefined);
});

test('preserves unchanged paid v33 and v35 storyboard-start clips but rejects legacy automatic continuity', () => {
  const old = shot(1, { videoUrl: 'clip.mp4', videoStatus: 'completed', videoSegmentId: 'seg', videoSegmentStoryboardIds: ['scene-1'] });
  old.videoGenerationSignature = videoSegmentGenerationSignature([old]).replace(/^h3-v\d+-/, 'h3-v33-');
  assert.equal(isCompletedVideoSegment([old]), true);
  assert.equal(isCompletedVideoSegment([{ ...old, imageUrl: 'changed.jpg' }]), false);
  const recent = { ...old, videoGenerationSignature: videoSegmentGenerationSignature([old]).replace(/^h3-v\d+-/, 'h3-v35-') };
  assert.equal(isCompletedVideoSegment([recent]), true);
  const inherited = { ...old, continuousFromPrev: true };
  inherited.videoGenerationSignature = videoSegmentGenerationSignature([inherited]).replace(/^h3-v\d+-/, 'h3-v33-');
  assert.equal(hasLegacyAutomaticContinuity(inherited), true);
  assert.equal(isCompletedVideoSegment([inherited]), false);
  assert.equal(restoredStoryStep([inherited]), 5);
});

test('segment preview keeps the storyboard image and server rejects implicit tail frames', () => {
  const step5 = readFileSync(new URL('../components/Step5.tsx', import.meta.url), 'utf8');
  const thumbnails = step5.slice(step5.indexOf('{group.map((item, shotIndex)'), step5.indexOf('{shotIndex < group.length - 1'));
  assert.match(thumbnails, /src=\{item.imageUrl\}/);
  assert.doesNotMatch(thumbnails, /<video/);
  assert.match(step5, /每镜使用自己的分镜图作为首帧/);
  assert.doesNotMatch(step5, /<option value="previous-segment-tail"/);
  const route = readFileSync(new URL('../app/api/generate-video/route.ts', import.meta.url), 'utf8');
  assert.match(route, /videoStoryboards.length !== 1 \|\| firstFrameUrl \|\| motionContext/);
  const page = readFileSync(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /immediatePrevious\.sequenceId === leader\.sequenceId/);
  assert.match(page, /comfyUIApiUrl\('\/api\/generate-video-prompt'/);
});

test('keeps every cinematic beat as one image and one independently generated shot', () => {
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
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1], [2], [3], [4], [5], [6], [7], [8], [9]]);
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
  assert.deepEqual(normalized.groups, [['scene-1'], ['scene-2'], ['scene-3']]);
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

test('generates question and answer independently while retaining their editorial relationship', () => {
  const groups = suggestVideoSegments([
    shot(1, { durationHint: 10 }),
    shot(2, { durationHint: 5, characters: ['A'], dialogueUnitId: 'dlg-1', speech: [{ character: 'A', exactLine: 'Who opened the gate?', source: 'story_required' }] }),
    shot(3, { durationHint: 5, characters: ['B'], dialogueUnitId: 'dlg-1', speech: [{ character: 'B', exactLine: 'I opened it before the flood.', source: 'story_required' }] }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1], [2], [3]]);
  assert.equal(cinematicEditKind(groups[1][0], groups[2][0]), 'dialogue-reverse');
});

test('a solo monologue followed by a detail is not a reverse conversation shot', () => {
  const previous = shot(1, { characters: ['A'], dialogueUnitId: 'solo', speech: [{ character: 'A', exactLine: 'Keep this drawing.', source: 'story_required' }] });
  const current = shot(2, { characters: ['A'], dialogueUnitId: 'solo', clipType: 'insert' });
  assert.equal(cinematicEditKind(previous, current), 'detail-insert');
  assert.notEqual(cinematicEditKind(previous, { ...current, clipType: 'action' }), 'dialogue-reverse');
});

test('a silent listener can still receive reverse coverage', () => {
  const previous = shot(1, { characters: ['A'], dialogueUnitId: 'exchange', speech: [{ character: 'A', exactLine: 'Keep this drawing.', source: 'story_required' }] });
  const current = shot(2, { characters: ['B'], dialogueUnitId: 'exchange', clipType: 'reaction' });
  assert.equal(cinematicEditKind(previous, current), 'dialogue-reverse');
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

test('migrates an unsubmitted manual multi-shot plan to individual shots', () => {
  const storyboards = [1, 2, 3, 4].map(number => shot(number, { durationHint: 3 }));
  const plan = createVideoSegmentPlan(storyboards, [storyboards.slice(0, 2), storyboards.slice(2)], 'manual');
  delete plan.planningContract;
  const restored = resolveVideoSegmentGroups(storyboards, JSON.parse(JSON.stringify(plan)));
  assert.equal(plan.version, 2);
  assert.equal(plan.source, 'manual');
  assert.deepEqual(restored.map(group => group.map(item => item.sceneNumber)), [[1], [2], [3], [4]]);
  assert.deepEqual(resolveVideoSegmentGroups([...storyboards].reverse(), plan).map(group => group.map(item => item.sceneNumber)), [[4], [3], [2], [1]]);
});

test('restores original per-shot speech when splitting an untouched old merged dialogue plan', () => {
  const storyboards = [
    shot(1, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: '第一部分说明。', source: 'story_required' }] }),
    shot(2, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: '第二部分结论。', source: 'story_required' }] }),
  ];
  const plan = createVideoSegmentPlan(storyboards, [storyboards]);
  assert.equal(plan.segments[0].speech.length, 1);
  assert.equal(plan.segments[0].speech[0].exactLine, '第一部分说明。第二部分结论。');
  const resolved = resolveVideoSegmentGroups(storyboards, plan);
  assert.deepEqual(resolved.map(group => group[0].speech[0].exactLine), ['第一部分说明。', '第二部分结论。']);
  assert.deepEqual(resolved.map(group => group[0].speech[0].sourceStoryboardId), ['scene-1', 'scene-2']);
});

test('keeps ordered multi-speaker dialogue at segment level with one block per identity', () => {
  const storyboards = [
    shot(1, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: '你确认入口安全吗？', source: 'story_required' }] }),
    shot(2, { characters: ['B'], speech: [{ character: 'B', voiceId: 'voice-b', exactLine: '我已经检查过两次。', source: 'story_required' }] }),
  ];
  const plan = createVideoSegmentPlan(storyboards, [storyboards]);
  assert.deepEqual(plan.segments[0].speech.map(line => line.character), ['A', 'B']);
  const resolved = resolveVideoSegmentGroups(storyboards, plan).flat();
  assert.deepEqual(resolved.flatMap(item => item.speech).map(line => line.exactLine), ['你确认入口安全吗？', '我已经检查过两次。']);
});

test('automatic recovery reuses manually generated planned speech without changing its provenance', () => {
  const raw = [shot(1, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: 'Hello there.', source: 'story_required' }] })];
  const plan = createVideoSegmentPlan(raw, [raw]);
  const [planned] = resolveVideoSegmentGroups(raw, plan);
  const signature = videoSegmentGenerationSignature(planned);
  const stored = raw.map(item => ({ ...item, videoStatus: 'completed', videoUrl: 'paid.mp4', videoSegmentId: 'seg', videoSegmentStoryboardIds: ['scene-1'], videoGenerationSignature: signature }));
  assert.equal(isCompletedVideoSegment(stored), false);
  assert.equal(isCompletedPlannedVideoSegment(stored, planned), true);
  assert.equal(restoredStoryStep(stored, plan), 6);
  assert.equal(stored[0].videoGenerationSignature, signature);
  assert.equal(refreshPlannedVideoSegment(stored, planned)[0].speech[0].sourceStoryboardId, 'scene-1');
  assert.equal(isCompletedPlannedVideoSegment([{ ...stored[0], imageUrl: 'new-stairs.jpg' }], planned), false);
});

test('legacy raw-speech cache is reusable only when the segment plan has equivalent dialogue', () => {
  const raw = [shot(1, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: 'Hello there.', source: 'story_required' }] })];
  const plan = createVideoSegmentPlan(raw, [raw]);
  const stored = raw.map(item => ({ ...item, videoStatus: 'completed', videoUrl: 'paid.mp4', videoSegmentId: 'seg', videoSegmentStoryboardIds: ['scene-1'], videoGenerationSignature: videoSegmentGenerationSignature(raw) }));
  assert.equal(isCompletedPlannedVideoSegment(stored, resolveVideoSegmentGroups(stored, plan)[0]), true);
  assert.equal(restoredStoryStep(stored, plan), 6);
  plan.segments[0].speech[0].exactLine = 'An explicitly edited line.';
  const [edited] = resolveVideoSegmentGroups(stored, plan);
  assert.equal(isCompletedPlannedVideoSegment(stored, edited), false);
  assert.equal(restoredStoryStep(stored, plan), 5);
  assert.equal(refreshPlannedVideoSegment(stored, edited)[0].speech[0].exactLine, 'An explicitly edited line.');
});

test('splits an A-B-A recurrence into valid consecutive dialogue edit units', () => {
  const groups = suggestVideoSegments([
    shot(1, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-1', characters: ['A'], speech: [{ speakerId: 'S1', character: 'A', voiceId: 'voice-a', exactLine: '第一句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
    shot(2, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-1', characters: ['B'], speech: [{ speakerId: 'S2', character: 'B', voiceId: 'voice-b', exactLine: '第二句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
    shot(3, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-2', characters: ['A'], speech: [{ speakerId: 'S1', character: 'A', voiceId: 'voice-a', exactLine: '第三句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
    shot(4, { durationHint: 3, clipType: 'dialogue', dialogueUnitId: 'exchange-2', characters: ['C'], speech: [{ speakerId: 'S3', character: 'C', voiceId: 'voice-c', exactLine: '第四句。', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }] }),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.sceneNumber)), [[1], [2], [3], [4]]);
  assert.equal(validateVideoSegment(groups[0]), undefined);
  assert.match(validateVideoSegment([shot(1, { characters: ['A'], imageUrl: 'x', dialogueLines: [{ character: 'A', text: '一。' }] }), shot(2, { characters: ['B'], imageUrl: 'x', dialogueLines: [{ character: 'B', text: '二。' }] }), shot(3, { characters: ['C'], imageUrl: 'x', dialogueLines: [{ character: 'C', text: '三。' }] }), shot(4, { characters: ['D'], imageUrl: 'x', dialogueLines: [{ character: 'D', text: '四。' }] })]), /最多绑定 3 个/);
});

test('approved single-shot A-B-A exchanges preserve ordered onsets and intentional repeated words', () => {
  const make = (character, text) => ({ speakerId: character, character, voiceId: `voice-${character}`, exactLine: text, emotion: 'calm', delivery: 'natural', volume: 'normal', lipSync: true, source: 'user_exact' });
  const authored = shot(1, { durationHint: 9, characters: ['A', 'B'], speech: [make('A', 'No.'), make('B', 'Are you sure?'), make('A', 'No.')] });
  assert.equal(validateVideoSegment([authored], 'en'), undefined);
  const plan = createVideoSegmentPlan([authored], [[authored]]);
  assert.deepEqual(plan.segments[0].speech.map(s => [s.character, s.exactLine]), [['A', 'No.'], ['B', 'Are you sure?'], ['A', 'No.']]);
  assert.equal(isValidVideoSegmentPlan(plan, [authored], 'en'), true);
  const generated = { ...authored, speech: authored.speech.map(s => ({ ...s, source: 'story_required' })) };
  // Generated repeated words are deduplicated; distinct recurrences still need splitting.
  generated.speech[2].exactLine = 'Absolutely not.';
  assert.match(validateVideoSegment([generated], 'en'), /再次开口/);
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
  assert.equal(estimateVideoSegmentSeconds(segment), 10);
  assert.equal(validateVideoSegment(segment), undefined);
});

test('extends a segment when dialogue must wait for a later storyboard', () => {
  const segment = [
    shot(1, {
      characters: [], clipType: 'insert', durationHint: 2,
      speech: [],
    }),
    shot(2, {
      characters: ['A'], clipType: 'reaction', durationHint: 2,
      speech: [{
        speakerId: 'S1', character: 'A', voiceId: 'voice-a',
        exactLine: 'Hold the gate until the others are safely inside.',
        emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'user_exact',
      }],
      audioPlan: { backgroundHuman: 'none', environment: [], foley: [], music: 'none', silenceBefore: 0.8, silenceAfter: 1 },
    }),
  ];
  // The raw speech budget is under six seconds, but the speaker cannot begin
  // until shot 2 appears. Six seconds therefore needs about 6.2 seconds in
  // the final timeline and must be promoted to the next legal whole second.
  assert.equal(estimateVideoSegmentSeconds(segment), 7);
  assert.equal(validateVideoSegment(segment), undefined);
});

test('automatically splits a group that cannot fit after delayed dialogue onset', () => {
  const storyboards = [
    shot(1, { characters: [], clipType: 'action', durationHint: 10, speech: [] }),
    shot(2, {
      characters: ['A'], clipType: 'reaction', durationHint: 2,
      speech: [{
        speakerId: 'S1', character: 'A', voiceId: 'voice-a',
        exactLine: 'Hold the gate until every child and every injured sailor has crossed the flooded chamber and reached the upper stairs beyond the western arch.',
        emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'user_exact',
      }],
      audioPlan: { backgroundHuman: 'none', environment: [], foley: [], music: 'none', silenceBefore: 0.8, silenceAfter: 1 },
    }),
  ];
  assert.equal(estimateVideoSegmentSeconds(storyboards), 16);
  assert.match(validateVideoSegment(storyboards), /超过 H3 的 15 秒上限/);
  assert.deepEqual(suggestVideoSegments(storyboards).map(group => group.map(item => item.sceneNumber)), [[1], [2]]);
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

test('a stale merge cannot invalidate already generated individual shots', () => {
  const individuallyGenerated = [shot(1), shot(2)].map((item, index) => ({
    ...item,
    videoStatus: 'completed',
    videoSegmentId: `old-segment-${index + 1}`,
    videoSegmentStoryboardIds: [item.id],
    videoCacheKey: `storyboard-video:project-1:${item.id}`,
  }));
  const plan = createVideoSegmentPlan(individuallyGenerated, [individuallyGenerated], 'manual');
  assert.equal(restoredStoryStep(individuallyGenerated, plan), 6);
});

test('uses a moving continuity handoff and trims the H3 restart', () => {
  assert.equal(CONTINUITY_HEAD_TRIM_SECONDS, CONTINUITY_HANDOFF_LEAD_SECONDS);
  assert.ok(CONTINUITY_HANDOFF_LEAD_SECONDS <= 0.3);
  assert.ok(CONTINUITY_HEAD_TRIM_SECONDS >= 0.12);
});


test('submitted historical multi-shot jobs retain membership and exact task ids across migration', () => {
  for (const status of ['generating', 'completed']) {
    const boards = [shot(1), shot(2), shot(3)].map((item, index) => ({ ...item,
      ...(index < 2 ? { videoStatus: status, videoSegmentId: 'paid-pair' } : {}),
      ...(index === 0 ? { videoTaskId: 'comfyui:existing-paid-task', videoSegmentStoryboardIds: ['scene-1', 'scene-2'], ...(status === 'completed' ? { videoUrl: 'paid.mp4' } : {}) } : {}),
    }));
    const plan = createVideoSegmentPlan(boards, [boards.slice(0, 2), boards.slice(2)]);
    plan.planningContract = 'cinematic-edit-v2';
    for (const legacy of [plan, undefined]) {
      const groups = resolveVideoSegmentGroups(boards, legacy);
      assert.deepEqual(groups.map(group => group.map(item => item.id)), [['scene-1', 'scene-2'], ['scene-3']]);
      assert.equal(groups[0][0].videoTaskId, 'comfyui:existing-paid-task');
      const normalized = normalizeVideoSegmentPlan(boards, legacy);
      assert.equal(normalizeVideoSegmentPlan(boards, normalized), normalized);
    }
  }
});

test('splitting an edited pending plan preserves the edited dialogue and its source shot', () => {
  const boards = [shot(1, { characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: 'Original.', source: 'user_exact', lipSync: true }] }), shot(2, { characters: ['A'] })];
  const plan = createVideoSegmentPlan(boards, [boards], 'manual');
  plan.segments[0].speech[0].exactLine = 'Edited line.';
  plan.segments[0].speech[0].sourceStoryboardId = 'scene-2';
  const groups = resolveVideoSegmentGroups(boards, plan);
  assert.deepEqual(groups.map(group => group.length), [1, 1]);
  assert.deepEqual(groups[0][0].speech, []);
  assert.equal(groups[1][0].speech[0].exactLine, 'Edited line.');
});

test('short single-shot action time ignores old rendered duration and fixed five-second padding', () => {
  assert.equal(estimateVideoSegmentSeconds([shot(1, { clipType: 'insert', durationHint: 2, videoDuration: 15, speech: [] })]), 2);
  assert.equal(estimateVideoSegmentSeconds([shot(1, { clipType: 'action', durationHint: 4, videoDuration: 15, speech: [] })]), 4);
  assert.equal(estimateVideoSegmentSeconds([shot(1, { clipType: 'long_take', durationHint: 11, speech: [] })]), 11);
});

test('redoing a paid merged clip restores original per-shot dialogue and can resume new single clips', () => {
  const boards = [1, 2].map(n => shot(n, {
    characters: ['A'], speech: [{ character: 'A', voiceId: 'voice-a', exactLine: n === 1 ? '先看这里。' : '然后再走。', source: 'user_exact', lipSync: true }],
    videoStatus: 'completed', videoSegmentId: 'paid-pair',
    ...(n === 1 ? { videoTaskId: 'paid', videoUrl: 'paid.mp4', videoSegmentStoryboardIds: ['scene-1', 'scene-2'] } : {}),
  }));
  const plan = createVideoSegmentPlan(boards, [boards]);
  const planned = resolveVideoSegmentGroups(boards, plan)[0];
  const singles = splitPlannedVideoSegment(boards, planned);
  assert.deepEqual(singles.map(([item]) => item.speech.map(line => line.exactLine)), [['先看这里。'], ['然后再走。']]);
  const newClips = singles.flat().map(item => ({ ...item, videoSegmentId: `new-${item.id}`, videoSegmentStoryboardIds: [item.id], videoUrl: `${item.id}.mp4`, videoGenerationSignature: videoSegmentGenerationSignature([item]) }));
  assert.ok(splitPlannedVideoSegment(newClips, planned).every(single => isCompletedPlannedVideoSegment(newClips, single)));
  assert.deepEqual(resolveVideoSegmentGroups(newClips, plan).map(group => group.map(item => item.id)), [['scene-1'], ['scene-2']]);
  plan.segments[0].speech[0].exactLine = '用户改过的对白。';
  plan.segments[0].speech[0].sourceStoryboardId = 'scene-2';
  const edited = splitPlannedVideoSegment(boards, resolveVideoSegmentGroups(boards, plan)[0]);
  assert.equal(edited[1][0].speech[0].exactLine, '用户改过的对白。');
});
