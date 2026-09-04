import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { adaptedStoryCharacters, parseStoryCastAdaptation, rewriteCastReferences, storyCastKey, StoryCastAmbiguityError } from '../lib/pipeline/storyCastAdaptation.ts';
import { adaptStoryCast, buildStoryCastAdaptationPrompt } from '../lib/pipeline/castAdapter.ts';
import { expandStoryCharacters, generateStoryPlan, parseSourceDialogueByShot } from '../lib/pipeline/storyWriter.ts';
import { canonicalizeStoryIdentities } from '../lib/pipeline/storyIdentity.ts';
import { effectiveStoryCast } from '../lib/storyCast.ts';
import { sourceShotBlocks, sourceShotVisualFields } from '../lib/pipeline/sourceScreenplay.ts';

const cast = [
  { id: 'maid-card', name: '青鸾', description: '宫女，递送与收拾物品', gender: 'female', ageGroup: 'young_adult' },
  { id: 'empress-card', name: '皇后萧明仪', description: '皇后，宫廷权力中心，负责审视进贡者', gender: 'female', ageGroup: 'adult' },
  { id: 'official-card', name: '裴行简', description: '文弱但机灵的内廷官，献宝与验宝', gender: 'male', ageGroup: 'adult' },
].map(character => ({ ...character, imageUrl: `${character.id}.png`, voiceId: `voice-${character.id}`, voiceLocked: true, voiceSource: 'user' }));
const source = `镜1 时长：4秒
景别：中景 动作：贵妃抬手一甩，黑灰色纱布面膜拍在地上；裴大人脸色惨白。 运镜：从手部跟拍向下，再推到惨白的脸。
台词：贵妃：“这是何物？” 裴大人：“贵妃娘娘，这是敷脸的！”
镜2 时长：4秒
景别：近景 动作：宫女夹起面膜，皱眉；贵妃抬眼。 运镜：推近手部。
台词：宫女：“娘娘，您看。” 贵妃：“裴大人，你先试。”
镜3 时长：5秒
景别：中景 动作：裴大人跪在软垫上，闭眼敷面膜；宫女捂嘴憋笑。 运镜：固定机位。
台词：裴大人：“臣有点困。”
镜4 时长：4秒
景别：中景 动作：贵妃转身走了两步，停下，没有回头；宫女偷偷笑。 运镜：跟拍背影。
台词：贵妃：“给本宫也拿一片。”`;
const speakers = ['贵妃', '裴大人', '宫女'];
const rawMapping = {
  bindings: [
    { sourceNames: ['贵妃'], targetName: '皇后萧明仪', dialogueName: '皇后', sourceRole: '贵妃', targetRole: '皇后', reason: '宫廷权力中心，审视进贡者并试用面膜' },
    { sourceNames: ['裴大人'], targetName: '裴行简', dialogueName: '裴大人', sourceRole: '官员', targetRole: '内廷官', reason: '同姓献宝者与验宝对象' },
    { sourceNames: ['宫女'], targetName: '青鸾', dialogueName: '青鸾', sourceRole: '宫女', targetRole: '宫女', reason: '递送面膜并收拾物品' },
  ], newCharacters: [], ambiguous: [],
};
const parse = (raw = rawMapping, script = source, selected = cast, names = speakers, props = []) => parseStoryCastAdaptation(raw, script, selected, names, props);
const request = { source, characters: cast, objects: [], requiredNames: speakers, apiKey: '', dmxApiKey: 'fixture-only', scriptProvider: 'dmx', scriptModel: 'gpt-4o' };
const response = content => ({ status: 200, headers: {}, data: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] } });

async function isolated(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'aid-cast-adaptation-'));
  const oldRoot = process.env.AID_COMPANION_DATA_DIR, post = axios.post;
  process.env.AID_COMPANION_DATA_DIR = root;
  try { await run(root); }
  finally {
    axios.post = post;
    if (oldRoot === undefined) delete process.env.AID_COMPANION_DATA_DIR; else process.env.AID_COMPANION_DATA_DIR = oldRoot;
    await rm(root, { recursive: true, force: true });
  }
}

test('semantic casting produces three identities, preserving selected card IDs, images and voices', () => {
  const before = structuredClone(cast), adaptation = parse();
  const selected = adaptedStoryCharacters(cast, adaptation);
  const expanded = expandStoryCharacters(adaptation.adaptedSource, selected, 'zh', false);
  assert.deepEqual(cast, before);
  assert.deepEqual(expanded.characters.map(c => c.name), cast.map(c => c.name));
  assert.deepEqual(effectiveStoryCast(cast, expanded.characters), cast);
  for (let index = 0; index < cast.length; index++) {
    for (const key of ['id', 'imageUrl', 'voiceId', 'voiceSource', 'voiceLocked']) assert.equal(expanded.characters[index][key], cast[index][key]);
  }
  const normalized = canonicalizeStoryIdentities({ speech: speakers.map(character => ({ character, exactLine: '不变。' })) }, selected);
  assert.deepEqual(normalized.speech.map(line => line.character), ['皇后萧明仪', '裴行简', '青鸾']);
  assert.deepEqual(normalized.speech.map(line => line.speakerId), ['S2', 'S3', 'S1']);
  assert.equal(adaptation.bindings[0].targetId, 'empress-card');
});

test('adaptation only changes identity tokens, including CJK names next to verbs and titles in quotes', () => {
  const adaptation = parse();
  const expected = source.replaceAll('贵妃', '皇后萧明仪').replaceAll('裴大人', '裴行简').replaceAll('宫女', '青鸾')
    .replace('“皇后萧明仪娘娘，这是敷脸的！”', '“皇后娘娘，这是敷脸的！”')
    .replace('“裴行简，你先试。”', '“裴大人，你先试。”');
  assert.equal(adaptation.adaptedSource, expected);
  const originalShots = sourceShotBlocks(source), adaptedShots = sourceShotBlocks(expected);
  assert.equal(adaptedShots.length, originalShots.length);
  originalShots.forEach((shot, index) => {
    const originalVisual = sourceShotVisualFields(shot.text), adaptedVisual = sourceShotVisualFields(adaptedShots[index].text);
    assert.equal(adaptedVisual.cameraMove, originalVisual.cameraMove);
    assert.equal(adaptedVisual.shotSize, originalVisual.shotSize);
  });
  const dialogue = parseSourceDialogueByShot(expected, cast.map(c => c.name));
  assert.equal(dialogue.get(1)[1].text, '皇后娘娘，这是敷脸的！');
  assert.equal(dialogue.get(2)[1].text, '裴大人，你先试。');
  assert.equal(dialogue.get(4)[0].text, '给本宫也拿一片。');
});

test('names are not recursively replaced; props, target full names, crowds and other people are protected', () => {
  const bindings = [{ ...rawMapping.bindings[0], targetName: '沈贵妃', dialogueName: '沈贵妃' }, rawMapping.bindings[2]];
  const result = rewriteCastReferences('沈贵妃抬手，贵妃站起；贵妃面膜放桌上；另一名宫女、其他宫女和宫女们看着宫女。', bindings, ['贵妃面膜']);
  assert.equal(result, '沈贵妃抬手，沈贵妃站起；贵妃面膜放桌上；另一名宫女、其他宫女和宫女们看着青鸾。');
});

test('English boundaries and quoted contractions do not leak dialogue names into prose', () => {
  const bindings = [{ ...rawMapping.bindings[0], sourceNames: ['Ann'], targetName: 'Queen Anne', dialogueName: 'Your Majesty' }];
  assert.equal(rewriteCastReferences(`Ann's hand stops. Don't let Ann move. Annette says: "Ann, don't move." Ann: 'Ann, wait.'`, bindings),
    `Queen Anne's hand stops. Don't let Queen Anne move. Annette says: "Your Majesty, don't move." Queen Anne: 'Your Majesty, wait.'`);
});

test('unknown targets, missing speakers, duplicate assignments and invented characters cannot bypass matching', () => {
  const invalidTarget = structuredClone(rawMapping); invalidTarget.bindings[0].targetName = '陌生皇后';
  assert.throws(() => parse(invalidTarget), /实际出现的称呼与已选人物/);
  assert.throws(() => parse({ ...rawMapping, bindings: rawMapping.bindings.slice(1) }), /遗漏原稿说话人：贵妃/);
  assert.throws(() => parse({ ...rawMapping, bindings: [...rawMapping.bindings, rawMapping.bindings[0]] }), /多个独立角色不能合并/);
  assert.throws(() => parse({ ...rawMapping, newCharacters: ['太医'] }), /新增人物只能/);
  assert.throws(() => parse(rawMapping, source, cast, speakers, ['贵妃']), /登记道具/);
});

test('registered alias relationships cannot be overridden and must still be adapted in prose', () => {
  const explicit = cast.map(c => c.name === '青鸾' ? { ...c, aliases: ['贵妃'] } : c);
  assert.throws(() => parse(rawMapping, source, explicit), /已有的明确选角/);
  const correct = cast.map(c => c.name === '皇后萧明仪' ? { ...c, aliases: ['贵妃'] } : c);
  assert.throws(() => parse({ ...rawMapping, bindings: rawMapping.bindings.slice(1) }, source, correct), /遗漏原稿说话人/);
  assert.match(parse(rawMapping, source, correct).adaptedSource, /皇后萧明仪抬手/);
});

test('adapted titles cannot create an ambiguous cross-character alias', () => {
  const ambiguous = structuredClone(rawMapping); ambiguous.bindings[2].dialogueName = '皇后';
  assert.throws(() => parse(ambiguous), /适配后称谓“皇后”对应多人/);
  const conflict = structuredClone(rawMapping); conflict.bindings[0].dialogueName = '青鸾';
  assert.throws(() => parse(conflict), /已对应其他人物/);
});

test('confirmed independent characters remain new, even with a single unrelated selected card', () => {
  const independent = '镜1\n动作：守卫拦下旅人。\n台词：守卫：“请止步。”';
  const selected = [{ name: '旅人', description: '被拦下的旅人' }];
  const adaptation = parse({ bindings: [], newCharacters: ['守卫'], ambiguous: [] }, independent, selected, ['守卫']);
  assert.equal(adaptation.adaptedSource, independent);
  const expanded = expandStoryCharacters(adaptation.adaptedSource, adaptedStoryCharacters(selected, adaptation), 'zh', false);
  assert.deepEqual(expanded.characters.map(c => c.name), ['旅人', '守卫']);
  assert.match(expanded.canonicalSynopsis, /守卫：“请止步。”/);
});

test('confirmed independent silent roles are not discarded merely for having no dialogue', () => {
  const script = '镜1\n动作：旅人转身，无声的守卫拦住门口。';
  const selected = [{ name: '旅人', description: '被拦下的旅人' }];
  const adaptation = parse({ bindings: [], newCharacters: ['守卫'], ambiguous: [] }, script, selected, []);
  const expanded = expandStoryCharacters(adaptation.adaptedSource, selected, 'zh', false, adaptation.newCharacters);
  assert.deepEqual(expanded.characters.map(c => c.name), ['旅人', '守卫']);
  assert.equal(expanded.canonicalSynopsis, script);
});

test('prompt requests semantic matching and identity-only adaptation, not new media or wholesale rewriting', () => {
  const prompt = buildStoryCastAdaptationPrompt(source, cast, speakers);
  assert.match(prompt, /按指定人物改写剧中的身份与称谓/);
  assert.match(prompt, /不能只按名字完全相同/);
  assert.match(prompt, /不修改剧情、动作、镜数、时长、道具、笑点或普通台词/);
  assert.doesNotMatch(prompt, /empress-card.png|voice-empress-card|fixture-only/);
  assert.equal(storyCastKey(cast), storyCastKey(cast.map(c => ({ ...c, voiceId: 'new-voice', imageUrl: 'new-image' }))));
  assert.notEqual(storyCastKey(cast), storyCastKey(cast.map(c => ({ ...c, description: 'new identity' }))));
});

test('matching draft is cached; image/voice changes reuse it, identity changes recast', async () => {
  await isolated(async root => {
    let calls = 0; axios.post = async () => { calls++; return response(rawMapping); };
    const result = await adaptStoryCast(request);
    assert.deepEqual(await adaptStoryCast(request), result);
    await adaptStoryCast({ ...request, characters: cast.map(c => ({ ...c, voiceId: 'changed' })) });
    assert.equal(calls, 1);
    await adaptStoryCast({ ...request, characters: cast.map(c => ({ ...c, description: `${c.description}，新设定` })) });
    assert.equal(calls, 2);
    for (const file of await readdir(path.join(root, 'pipeline-drafts'))) assert.doesNotMatch(await readFile(path.join(root, 'pipeline-drafts', file), 'utf8'), /fixture-only/);
  });
});

test('invalid mapping gets one bounded repair, explicit ambiguity does not trigger repeated model calls', async () => {
  await isolated(async () => {
    let calls = 0;
    axios.post = async (_url, body) => {
      calls++;
      if (calls === 1) return response({ ...rawMapping, bindings: [] });
      assert.match(body.messages[0].content, /上一轮结构问题.*遗漏原稿说话人/);
      return response(rawMapping);
    };
    assert.equal((await adaptStoryCast(request)).bindings.length, 3);
    assert.equal(calls, 2);
  });
  await isolated(async () => {
    let calls = 0;
    axios.post = async () => { calls++; return response({ bindings: [], newCharacters: [], ambiguous: ['贵妃'] }); };
    await assert.rejects(adaptStoryCast(request), StoryCastAmbiguityError);
    await assert.rejects(adaptStoryCast(request), StoryCastAmbiguityError);
    assert.equal(calls, 1, 'retained ambiguity requires clarification, not retries or duplicate cast');
  });
});

test('provider refusal is not resubmitted during casting adaptation', async () => {
  await isolated(async () => {
    let calls = 0;
    axios.post = async () => { calls++; return { status: 200, headers: {}, data: { choices: [{ message: { refusal: 'content_filter' }, finish_reason: 'content_filter' }] } }; };
    await assert.rejects(adaptStoryCast(request), /拒绝继续输出/);
    assert.equal(calls, 1);
  });
});

test('complete writer pipeline uses adapted identity/action/dialogue authority and retains original input', async () => {
  await isolated(async () => {
    const milestones = ['opening', 'inciting_incident', 'first_threshold', 'midpoint_reversal', 'crisis_choice', 'climax_proof', 'resolution'];
    const sequence = { id: 'palace', locationId: 'palace', shotCount: 4 };
    const spine = {
      title: '面膜选角', centralDramaticQuestion: '会试用面膜吗？', audiencePromise: '喜剧反转', dialogueArc: '质疑到接受', montageStrategy: '因果推进',
      characters: cast.map(c => ({ name: c.name, role: c.description, gender: c.gender, ageGroup: c.ageGroup })),
      structure: milestones.map((name, index) => ({ name, shotIndex: Math.min(4, 1 + Math.floor(index / 2)), event: '看见结果', audienceShift: '态度改变' })),
      sequences: [sequence],
    };
    const maps = [1, 2, 3, 4].map(index => ({ index, actionGoal: '模型摘要，不应覆盖原动作', cause: '上一动作', consequence: '产生结果', emotionalTurn: '惊讶', informationGain: '看见结果', montageRole: 'development', editBridge: 'causal trigger; audience realizes the change', audienceQuestion: '然后呢？', dialoguePurpose: 'visual_only' }));
    const prompts = [];
    axios.post = async (_url, body) => {
      const prompt = body.messages[0].content; prompts.push(prompt);
      if (prompts.length === 1) return response(rawMapping);
      assert.match(prompt, /皇后萧明仪/);
      if (prompts.length === 2) {
        assert.match(prompt, /皇后萧明仪抬手一甩/);
        assert.match(prompt, /本剧锁定身份：皇后/);
        return response(spine);
      }
      if (prompts.length === 3) return response({ beatMap: maps });
      assert.ok(prompts.length <= 7, 'no unbounded repair or media call');
      return response({ beats: [{ characters: cast.map(c => c.name), durationHint: 5, action: '模型另写动作也不能替换原稿', conflict: '面对质疑', nextCause: '动作引发反应' }] });
    };
    const input = { ...request, synopsis: source, targetShotCount: 4, language: 'zh' };
    const before = structuredClone(input);
    const plan = await generateStoryPlan(input);
    assert.deepEqual(input, before);
    assert.equal(prompts.length, 7);
    assert.equal(plan.sourceBrief, source);
    assert.equal(plan.castAdaptation.adaptedSource, parse().adaptedSource);
    assert.deepEqual(plan.characters.map(c => c.name), cast.map(c => c.name));
    assert.equal(plan.characters.find(c => c.name === '皇后萧明仪').role, '皇后');
    const beats = plan.sequences.flatMap(s => s.beats), expectedShots = sourceShotBlocks(parse().adaptedSource);
    assert.equal(beats.length, 4);
    beats.forEach((beat, index) => assert.equal(beat.action, sourceShotVisualFields(expectedShots[index].text).action));
    assert.deepEqual(beats[0].speech.map(line => line.exactLine), ['这是何物？', '皇后娘娘，这是敷脸的！']);
    assert.deepEqual(beats[0].speech.map(line => line.speakerId), ['S2', 'S3']);
    for (const line of beats.flatMap(beat => beat.speech)) {
      assert.equal(line.voiceId, cast.find(c => c.name === line.character).voiceId);
      assert.equal(line.source, 'user_exact');
    }
    assert.deepEqual(effectiveStoryCast(cast, plan.characters), cast);
    await generateStoryPlan(input);
    assert.equal(prompts.length, 7, 'retry reuses every retained cast/writer checkpoint');
  });
});
