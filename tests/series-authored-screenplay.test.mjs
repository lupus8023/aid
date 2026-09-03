import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeries, parseEpisodes, parseOutline, parseScript, rescanSeriesObjectUsage } from '../lib/series/domain.ts';
import { parseAuthoredScreenplay } from '../lib/series/authoredScreenplay.ts';
import { seriesPrompt } from '../lib/series/prompts.ts';
import { episodeFixtures, outlineFixture } from './fixtures/series.mjs';

const authoredBrief = `镜1 时长：3秒

景别：中景带前景 动作：林知夏抬手一甩，旧照片啪地落进显影盘，陈叔的表情瞬间僵住。 运镜：从林知夏手部跟拍到显影盘，最后快速定格陈叔的脸。 氛围：开局强冲突。 AI生图提示词：旧照相馆内，林知夏把旧照片甩进显影盘，陈叔脸色发白，暖色侧光，电影质感。 台词：林知夏：“这块表，我见过。” 陈叔：“你不该看见它。”

镜2 时长：4秒

景别：双人近景 动作：林知夏伸出手指点住照片里的手表，陈叔慌忙移开视线。 运镜：先拍指尖与手表，再推到陈叔躲闪的眼睛。 氛围：疑问收紧。 AI生图提示词：旧照片与手指特写，背景中的陈叔移开视线，写实电影摄影。 台词：林知夏：“告诉我真相。”`;

test('recognizes a formed screenplay and keeps its shot count instead of expanding to 18', () => {
  const authored = parseAuthoredScreenplay(authoredBrief, 'zh');
  assert.equal(authored?.shots.length, 2);
  assert.equal(authored?.shots[0].action, '林知夏抬手一甩，旧照片啪地落进显影盘，陈叔的表情瞬间僵住。');
  assert.equal(authored?.shots[0].camera, '从林知夏手部跟拍到显影盘，最后快速定格陈叔的脸。');
  assert.deepEqual(authored?.shots[0].dialogueLines, ['这块表，我见过。', '你不该看见它。']);
  assert.ok(authored.shots[0].seconds > authored.shots[0].sourceSeconds);

  const project = createSeries({ name: '已有成稿', brief: authoredBrief, episodeCount: 12 });
  assert.equal(project.sourceMode, 'authored_screenplay');
  assert.equal(project.episodeCount, 1);
  assert.equal(project.shotCount, 2);
  assert.equal(project.durationSeconds, authored.durationSeconds);
});

test('allows a one-episode project even when the brief is not a formed screenplay', () => {
  const project = createSeries({ name: '单集故事', brief: '一个完整的单集故事。', episodeCount: 1 });
  assert.equal(project.episodeCount, 1);
  assert.equal(project.sourceMode, undefined);
});

test('authored screenplay prompt locks action, camera, image prompt and exact dialogue', () => {
  const project = createSeries({ name: '已有成稿', brief: authoredBrief, episodeCount: 12 });
  Object.assign(project, parseOutline({
    ...outlineFixture(),
    bible: { ...outlineFixture().bible, arcs: [{ start: 1, end: 1, goal: '查明照片真相', reversal: '陈叔暴露反应' }], promises: [{ question: '照片是什么？', plantedIn: 1, payoffIn: 1, answer: '照片留下手表线索' }] },
  }, project));
  const episodeRaw = episodeFixtures().episodes[0];
  episodeRaw.nextOpening = '';
  episodeRaw.plants = ['p1'];
  episodeRaw.paysOff = ['p1'];
  project.episodes = parseEpisodes({ episodes: [episodeRaw] }, project, 1, 1);
  const prompt = seriesPrompt('script', project, project.episodes[0].id);
  assert.match(prompt, /权威成稿，不是供改编的故事素材/);
  assert.match(prompt, /禁止新增、删除、合并、拆分、调序或替换事件和镜头/);
  assert.match(prompt, /action必须原样复制“动作”/);
  assert.match(prompt, /绝不能靠删改台词解决/);

  const raw = {
    shots: [
      { number: 1, seconds: 3, locationId: 'l1', characterIds: ['c1', 'c2'], objectIds: [], visual: '模型另写的画面', action: '模型另写的动作', dialogue: [{ characterId: 'c1', text: '这块表，我见过。', emotion: '质问' }, { characterId: 'c2', text: '你不该看见它。', emotion: '惊慌' }], sound: '照片落水声', purpose: '模型总结' },
      { number: 2, seconds: 4, locationId: 'l1', characterIds: ['c1', 'c2'], objectIds: [], visual: '模型另写的画面', action: '模型另写的动作', dialogue: [{ characterId: 'c1', text: '告诉我真相。', emotion: '坚定' }], sound: '室内底噪', purpose: '模型总结' },
    ],
  };
  const script = parseScript(raw, project, project.episodes[0]);
  assert.equal(script[0].action, parseAuthoredScreenplay(authoredBrief).shots[0].action);
  assert.equal(script[0].visual, parseAuthoredScreenplay(authoredBrief).shots[0].imagePrompt);
  assert.equal(script[0].camera, parseAuthoredScreenplay(authoredBrief).shots[0].camera);
  assert.equal(script[0].seconds, parseAuthoredScreenplay(authoredBrief).shots[0].seconds);
  assert.throws(() => parseScript({ shots: raw.shots.map((shot, index) => index ? shot : { ...shot, dialogue: [{ ...shot.dialogue[0], text: '模型改写了台词。' }] }) }, project, project.episodes[0]), /没有逐字保留用户原稿台词/);
});

test('formed screenplay keeps original prop wording while objectIds bind the registered asset', () => {
  const project = createSeries({ name: '已有成稿', brief: authoredBrief, episodeCount: 1 });
  Object.assign(project, parseOutline({
    ...outlineFixture(),
    objects: [{
      name: '黄铜旧怀表', aliases: [], description: '一块有划痕的黄铜旧怀表',
      continuity: '外观保持一致', source: 'auto', referenceMode: 'auto',
    }],
    bible: { ...outlineFixture().bible, arcs: [{ start: 1, end: 1, goal: '查明照片真相', reversal: '陈叔暴露反应' }], promises: [{ question: '照片是什么？', plantedIn: 1, payoffIn: 1, answer: '照片留下手表线索' }] },
  }, project));
  const episodeRaw = episodeFixtures().episodes[0];
  episodeRaw.nextOpening = '';
  episodeRaw.plants = ['p1'];
  episodeRaw.paysOff = ['p1'];
  project.episodes = parseEpisodes({ episodes: [episodeRaw] }, project, 1, 1);

  const source = parseAuthoredScreenplay(authoredBrief).shots;
  const raw = {
    shots: source.map((shot, index) => ({
      number: index + 1,
      seconds: shot.sourceSeconds,
      locationId: 'l1',
      characterIds: ['c1', 'c2'],
      objectIds: ['o1'],
      visual: '模型返回的画面',
      action: '模型返回的动作',
      dialogue: shot.dialogueLines.map((line, lineIndex) => ({ characterId: lineIndex === 1 ? 'c2' : 'c1', text: line, emotion: '自然' })),
      sound: '环境声',
      purpose: '推进剧情',
    })),
  };
  const script = parseScript(raw, project, project.episodes[0]);
  assert.equal(script[1].visual, source[1].imagePrompt);
  assert.equal(script[1].action, source[1].action);
  assert.deepEqual(script[1].objectIds, ['o1']);

  project.episodes[0].script = script;
  project.episodes = rescanSeriesObjectUsage(project);
  assert.deepEqual(project.episodes[0].script[1].objectIds, ['o1']);
});

test('a user-added prop may minimally extend a formed screenplay without replacing its original fields', () => {
  const project = createSeries({ name: '成稿新增道具', brief: authoredBrief, episodeCount: 1 });
  Object.assign(project, parseOutline({
    ...outlineFixture(),
    objects: [{ name: '银针', aliases: [], description: '细长银针，尾端有一处弯折' }],
    bible: { ...outlineFixture().bible, arcs: [{ start: 1, end: 1, goal: '查明照片真相', reversal: '陈叔暴露反应' }], promises: [{ question: '照片是什么？', plantedIn: 1, payoffIn: 1, answer: '照片留下手表线索' }] },
  }, project));
  project.objects[0].narrativeRequired = true;
  const episodeRaw = episodeFixtures().episodes[0];
  episodeRaw.nextOpening = '';
  episodeRaw.plants = ['p1'];
  episodeRaw.paysOff = ['p1'];
  episodeRaw.synopsis += '林知夏用银针挑起照片边角。';
  project.episodes = parseEpisodes({ episodes: [episodeRaw] }, project, 1, 1);
  const source = parseAuthoredScreenplay(authoredBrief).shots;
  const raw = { shots: source.map((shot, index) => ({
    number: index + 1,
    seconds: shot.sourceSeconds,
    locationId: 'l1',
    characterIds: ['c1', 'c2'],
    objectIds: index === 0 ? ['o1'] : [],
    visual: index === 0 ? `${shot.imagePrompt} 桌边放着银针。` : shot.imagePrompt,
    action: shot.action,
    dialogue: shot.dialogueLines.map((line, lineIndex) => ({ characterId: lineIndex === 1 ? 'c2' : 'c1', text: line, emotion: '自然' })),
    sound: '环境声', purpose: shot.atmosphere,
  })) };
  const script = parseScript(raw, project, project.episodes[0]);
  assert.ok(script[0].visual.includes(source[0].imagePrompt));
  assert.match(script[0].visual, /银针/);
  assert.equal(script[0].imagePrompt, script[0].visual);
  assert.deepEqual(script[0].objectIds, ['o1']);
  const rewritten = structuredClone(raw);
  rewritten.shots[0].visual = '林知夏拿着银针改做另一件事。';
  assert.throws(() => parseScript(rewritten, project, project.episodes[0]), /必须完整保留用户原稿/);
});
