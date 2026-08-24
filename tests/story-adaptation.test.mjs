import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStoryAdaptationCorrection, buildStoryAdaptationPrompt, validateAdaptedStoryScript } from '../lib/pipeline/storyAdaptationPrompt.ts';

test('adapts the brief to the selected exact shot count and runtime', () => {
  const prompt = buildStoryAdaptationPrompt({
    brief: '一个人在暴雨中寻找走失的狗。原计划只拍两个镜头。',
    language: 'zh',
    targetShotCount: 36,
  });

  assert.match(prompt, /严格输出 36 个编号剧情节拍/);
  assert.match(prompt, /目标成片约 180 秒/);
  assert.match(prompt, /最后一行编号必须是 36/);
  assert.match(prompt, /以 36 镜为准/);
  assert.match(prompt, /不写焦距、运镜、光圈/);
  assert.match(prompt, /每个有对白的场次至少形成一个完整对白单元/);
  assert.match(prompt, /禁止孤立口号和失去指代的碎片/);
  assert.match(prompt, /连续拆到相邻镜头/);
  assert.match(prompt, /每镜最多 3 轮台词/);
  assert.match(prompt, /总计不得超过 H3 15 秒/);
  assert.match(prompt, /普通原稿台词允许压缩、重写或合并/);
  assert.match(prompt, /明确写明“必须逐字保留”“不可改”“原句照读”/);
  assert.doesNotMatch(prompt, /新增台词必须简短/);
});

test('normalizes unsupported shot counts and keeps English output explicit', () => {
  const prompt = buildStoryAdaptationPrompt({
    brief: 'A quiet reunion at a train station.',
    language: 'en',
    targetShotCount: 35,
  });

  assert.match(prompt, /exactly 36 numbered story beats/);
  assert.match(prompt, /SHOT 01 through SHOT 36/);
  assert.match(prompt, /SHOT NN \| sequence\/location/);
});

test('accepts an adapted screenplay only when it is directly convertible to the video JSON contract', () => {
  const script = Array.from({ length: 9 }, (_, offset) => {
    const index = offset + 1;
    const dialogue = index === 1
      ? '台词：仙仙：“我会在天黑前把五色石带回来。”'
      : '台词：无';
    return `镜头 ${String(index).padStart(2, '0')}｜场次/地点｜可见动作 ${index}｜${dialogue}`;
  }).join('\n');
  assert.deepEqual(validateAdaptedStoryScript(script, 9), {
    valid: true,
    errors: [],
    shotCount: 9,
  });
});

test('rejects overloaded dialogue before the screenplay reaches structured story generation', () => {
  const longLine = 'I have carried every gate since dawn and I will not leave this chamber while the whole city still believes only my hands can hold back the sea and guide every family safely home tonight.';
  const script = Array.from({ length: 9 }, (_, offset) => {
    const index = offset + 1;
    const dialogue = index === 1
      ? `dialogue: Lanxi: “${longLine}” A-Luo: “Then you have made the whole city depend on your fear.”`
      : 'dialogue: NONE';
    return `SHOT ${String(index).padStart(2, '0')} | sequence/location | visible action ${index} | ${dialogue}`;
  }).join('\n');
  const validation = validateAdaptedStoryScript(script, 9);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /超过 H3 15 秒/);
  assert.match(buildStoryAdaptationCorrection(validation.errors), /重新输出完整改编稿/);
  assert.match(buildStoryAdaptationCorrection(validation.errors), /普通原稿台词可在不改变剧情事实/);
  assert.match(buildStoryAdaptationCorrection(validation.errors), /相邻镜头/);
});

test('rejects skipped shot numbers, excessive turns and spoken directing instructions', () => {
  const script = [
    '镜头 01｜场次/地点｜动作｜台词：A：“先短暂停顿，再以坚定语气说” B：“回应。” C：“继续。” D：“结束。”',
    ...Array.from({ length: 8 }, (_, offset) => `镜头 ${String(offset + 3).padStart(2, '0')}｜场次/地点｜动作｜台词：无`),
  ].join('\n');
  const validation = validateAdaptedStoryScript(script, 9);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /必须连续编号为 2/);
  assert.match(validation.errors.join('\n'), /最多安排 3 轮/);
  assert.match(validation.errors.join('\n'), /表演指令/);
});
