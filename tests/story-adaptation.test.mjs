import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStoryAdaptationPrompt } from '../lib/pipeline/storyAdaptationPrompt.ts';

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
