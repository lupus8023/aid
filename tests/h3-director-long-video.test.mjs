import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildH3DirectorGraph, directorFrameCount, directorGraphInfo, directorPlanningPrompt, normalizeDirectorSegmentTimecodes, validateDirectorPlan } from '../lib/h3Director.ts';
import { H3_DIRECTOR_COMPANION_MIN_VERSION } from '../lib/comfyuiClient.ts';

function definitions(legacy = false) {
  return Object.fromEntries(['MiniMaxH3Director', 'MiniMaxH3DirectorGroupImageToVideo', 'MiniMaxH3DirectorGroupsCombine', 'UNETLoader', 'CLIPLoader', 'VAELoader', 'LoadImage', 'CreateVideo', 'SaveVideo', 'LoraLoaderBypassModelOnly', 'MiniMaxH3MemoryEfficientSageAttentionPatch', 'PreviewAny'].map(name => [name, name === 'MiniMaxH3DirectorGroupsCombine' && legacy ? { input: { optional: { group_0: ['MMX_DIR_GROUP'] } } } : {}]));
}
const plan = duration => ({ sourcePrompt: '原稿：先抬手，再展示面膜，然后停住。', duration, segments: Array.from({ length: duration / 10 }, (_, i) => ({ prompt: `00:00.800时执行动作_${i + 1}。对白：<d>[English] LINE_${i + 1}</d>。00:09.500时自然停稳。` })) });
const build = (duration, overrides = {}) => buildH3DirectorGraph({ plan: plan(duration), remoteImage: 'aid/assets/original.png', aspectRatio: '9:16', seed: 123, directorNodeId: '1234567890', outputPrefix: 'aid/director/test/final', definitions: definitions(), ...overrides });

test('30/60 seconds compile as 3/6 linked 10-second groups with a single real first frame', () => {
  for (const duration of [30, 60]) {
    const built = build(duration);
    const info = directorGraphInfo(built.prompt);
    assert.equal(info.totalSegments, duration / 10);
    assert.equal(built.totalSegments, duration / 10);
    assert.equal(directorFrameCount(10), 243);
    const timeline = JSON.parse(info.inputs.timeline_data);
    assert.equal(timeline.output.continuityEnabled, true);
    assert.equal(timeline.output.continuityOverlapFrames, 22);
    assert.equal(timeline.output.exportMode, 'all');
    assert.equal(timeline.output.audioMode, 'generate');
    assert.equal(timeline.output.maxExportFrames, 0);
    assert.deepEqual(timeline.segments.map(s => s.continuityFromPrev), [false, ...Array(duration / 10 - 1).fill(true)]);
    assert.equal(timeline.totalFrames, 243 * duration / 10);
    assert.equal(info.inputs.width, 480);
    assert.equal(info.inputs.height, 864);
    assert.equal(info.inputs.steps, 4);
    assert.equal(info.inputs.sampler, 'euler');
    assert.equal(built.prompt['3'].class_type, 'LoraLoaderBypassModelOnly');
    assert.equal(info.inputs.refine, undefined);
    for (let i = 0; i < duration / 10; i++) {
      const group = built.prompt[String(20 + i)];
      assert.equal(group.inputs.duration_sec, 10);
      if (i === 0) assert.deepEqual(group.inputs.first_frame, ['10', 0]);
      else assert.equal(group.inputs.first_frame, undefined, 'later segment must not reset to original');
      assert.deepEqual(built.prompt['28'].inputs[`groups.group_${i}`], [String(20 + i), 0]);
      assert.match(group.inputs.prompt, new RegExp(`动作_${i + 1}`));
      assert.equal((group.inputs.prompt.match(/LINE_\d+/g) || []).length, 1, 'never concatenate the full source dialogue into each segment');
    }
    assert.deepEqual(built.prompt['31'].inputs.images, ['1234567890', 0]);
    assert.deepEqual(built.prompt['31'].inputs.audio, ['1234567890', 1]);
    assert.deepEqual(built.prompt['32'].inputs.video, ['31', 0]);
  }
});

test('global model timecodes are deterministically rebased before the continuity prefix is added', () => {
  assert.equal(
    normalizeDirectorSegmentTimecodes('### 00:10.000–00:20.000\n动作持续到 00:19.500。', 1),
    '### 00:00.000–00:10.000\n动作持续到 00:09.500。',
  );
  assert.equal(
    normalizeDirectorSegmentTimecodes('### 00:50.000–01:00.000', 5),
    '### 00:00.000–00:10.000',
  );
  assert.equal(
    normalizeDirectorSegmentTimecodes('### 00:00.000–00:10.000', 5),
    '### 00:00.000–00:10.000',
  );
});

test('continuation timestamps move past borrowed AV context and preserve spoken words', () => {
  const { prompt } = build(30);
  assert.match(prompt['20'].inputs.prompt, /00:00\.800/);
  assert.match(prompt['21'].inputs.prompt, /00:01\.717/);
  assert.match(prompt['21'].inputs.prompt, /00:10\.417/);
  assert.match(prompt['21'].inputs.prompt, /<d>\[English] LINE_2<\/d>/);
  assert.match(prompt['21'].inputs.prompt, /上一段动态音画尾部/);
  assert.doesNotMatch(prompt['21'].inputs.prompt, /LINE_1|动作_1/);
});

test('plan must match the exact current source and duration before a paid submission', () => {
  assert.throws(() => validateDirectorPlan(plan(30), 60), /时长不符/);
  assert.throws(() => validateDirectorPlan(plan(30), 30, 'changed original'), /原提示词已改变/);
  assert.throws(() => validateDirectorPlan({ ...plan(30), segments: [] }, 30), /时长不符/);
  assert.throws(() => validateDirectorPlan({ ...plan(30), segments: [{ prompt: '' }, ...plan(30).segments.slice(1)] }, 30), /每段需要/);
  assert.throws(() => validateDirectorPlan(plan(30), 15), /仅支持/);
  assert.equal(validateDirectorPlan(plan(60), 60).segments.length, 6);
});

test('planner instructions preserve actions, exact dialogue and local timing without QC', () => {
  const instruction = directorPlanningPrompt('贵妃抬手："这是敷脸的。"', 60);
  assert.match(instruction, /6 个连续的10秒分段/);
  assert.match(instruction, /每句逐字台词只属于一个分段/);
  assert.match(instruction, /逐字台词、说话者和台词语言必须原样保留/);
  assert.match(instruction, /不写质检或评估说明/);
  assert.match(instruction, /所有分段说明必须使用简洁、自然、具象的中文/);
  assert.match(instruction, /贵妃抬手："这是敷脸的。"/);
});

test('cache IDs are isolated, known graph variants supported, missing nodes fail before short fallback', () => {
  const second = build(30, { directorNodeId: '1234567891', definitions: definitions(true), aspectRatio: '1:1' });
  assert.equal(directorGraphInfo(second.prompt).nodeId, '1234567891');
  assert.deepEqual(second.prompt['28'].inputs.group_0, ['20', 0]);
  assert.equal(directorGraphInfo(second.prompt).inputs.width, 640);
  assert.throws(() => build(30, { definitions: {} }), /不会回退成 15 秒/);
  assert.throws(() => build(30, { directorNodeId: '30' }), /独立的数字缓存编号/);
  assert.equal(directorGraphInfo({ '1': { class_type: 'Other' } }), undefined);
  assert.equal(directorGraphInfo({ '1': { class_type: 'MiniMaxH3Director', inputs: { timeline_data: 'broken' } } }), undefined);
});

test('all references resolve, no refine/QC nodes, both canvas orientations and shared source stay intact', () => {
  const { prompt } = build(60, { aspectRatio: '16:9' });
  for (const node of Object.values(prompt)) {
    assert.doesNotMatch(node.class_type, /refine|audit|ocr|asr/i);
    for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(prompt[value[0]], `missing node ${value[0]}`);
  }
  assert.equal(prompt['10'].inputs.image, 'aid/assets/original.png');
  assert.equal(directorGraphInfo(prompt).inputs.width, 864);
  assert.equal(directorGraphInfo(prompt).inputs.height, 480);
});

test('cloud compatibility patch preserves the tested four-step dual-clock contract', async () => {
  const patch = await readFile(new URL('../cloud/patches/core_sampling.aid.py', import.meta.url), 'utf8');
  assert.match(patch, /MiniMaxH3DualClockSamplerT8/);
  assert.match(patch, /sampler_name\) == "euler"/);
  assert.match(patch, /int\(steps\) == 4/);
  assert.match(patch, /shift_video.*12\.0/);
  assert.match(patch, /shift_audio.*3\.0/);
  assert.match(patch, /dual_clock_euler/);
});

test('production wiring guards older companions, keeps task IDs and only downloads final combined output', async () => {
  const [page, route, comfy, planner, middleware] = await Promise.all(['app/image-to-video/page.tsx', 'app/api/image-to-video/route.ts', 'lib/comfyui.ts', 'app/api/prepare-long-video/route.ts', 'middleware.ts'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
  assert.match(page, /if \(!status.h3DirectorLongVideo\) throw/);
  assert.deepEqual(H3_DIRECTOR_COMPANION_MIN_VERSION, [0, 1, 195]);
  assert.match(page, /companionVersionAtLeast\(String\(status.version \|\| ''\), H3_DIRECTOR_COMPANION_MIN_VERSION\)/);
  assert.match(page, /localStorage.setItem\(I2V_TASK_STORAGE/);
  assert.match(page, /继续查询（不重新生成）/);
  assert.match(page, /activeTask\?\.state === 'pending'/);
  assert.match(page, /task.backend !== taskBackend/);
  assert.match(route, /validateDirectorPlan\(directorPlan, Number\(duration\), prompt\)/);
  assert.ok(route.indexOf("comfyWorkflowMode === 'director_continuous'") < route.indexOf("if (videoProvider === 'fal')"));
  assert.match(route, /不能由短视频接口截短生成/);
  assert.match(comfy, /director \? item.outputs\?\.\['32'\]/);
  assert.match(comfy, /final_cached_count/);
  assert.match(planner, /attempts: 1/);
  assert.match(middleware, /\/api\/prepare-long-video/);
});
