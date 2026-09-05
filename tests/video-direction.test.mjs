import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildVideoSegmentPrompt, H3_PROMPT_MAX_CHARACTERS } from '../lib/videoGenerator.ts';
import { currentVideoDirection, validateVideoDirection, videoDirectionSourceKey, recoverReorderedObjectDirection, VIDEO_DIRECTION_LIMITS, VIDEO_DIRECTION_MAX_CHARACTERS } from '../lib/videoDirection.ts';
import { bindStoryboardReferences } from '../lib/storyVisualAssets.ts';
import { refineVideoDirections } from '../lib/pipeline/videoDirection.ts';
import { validateDirectorShots, buildDirectorPrompt, stripExactDialogueFromDescription } from '../lib/pipeline/storyDirector.ts';
import { videoSegmentGenerationSignature } from '../lib/videoSegments.ts';

const direction = (name = 'Lin') => ({
  action: `${name}撕开信封封口并抽出照片；看到照片后右手逐渐松开。`,
  camera: '腰部高度的中景镜头顺时针环绕九十度，照片碰到桌面时停住。',
  detail: '她的笑意在手指松开前消失，左手始终不动。',
  ending: '照片正面朝上落在桌面，右手仍悬在半空。',
});
const shot = (extra = {}) => ({
  id: 's1', sceneNumber: 1, characters: ['Lin'], objects: ['envelope'],
  action: 'Lin撕开信封，抽出照片，松手后照片落到桌上。',
  description: '她看见照片后松手。', prompt: 'Lin holds a sealed envelope at chest height.',
  status: 'completed', durationHint: 3, imageUrl: 'https://example.com/1.jpg',
  visualStyle: 'cinematic-natural', capturePreset: 'cinematic-narrative',
  audioPlan: { environment: [], foley: [], music: 'none', backgroundHuman: 'none' },
  ...extra,
});

test('motion brief survives Chinese source without becoming the still frame or a generic timeline', () => {
  const d = direction();
  const input = shot({ videoDirection: d });
  const p = buildVideoSegmentPrompt([input], [], { duration: 8, language: 'zh' });
  for (const text of Object.values(d)) assert.ok(p.includes(text), text);
  assert.doesNotMatch(p, /holds a sealed envelope|one weighted action peak|facial tension change once|00:01\.760/);
  assert.doesNotMatch(p, /From 00:00\.000 to 00:08\.000/);
  assert.match(p, /\[Shot 1] 本镜以<Picture 1>作为构图参考/);
  assert.ok(p.length <= H3_PROMPT_MAX_CHARACTERS);
});

test('registered Chinese names are bound without discarding the Chinese action or ending', () => {
  const d = direction('人鱼公主');
  const p = buildVideoSegmentPrompt([shot({ characters: ['人鱼公主'], videoDirection: d })], [], { duration: 8 });
  assert.match(p, /<Subject 1>撕开信封封口并抽出照片/);
  assert.ok(p.includes(d.ending));
  assert.doesNotMatch(p.split('detailed_description:')[1], /人鱼公主/);
  const legacy = buildVideoSegmentPrompt([shot({ characters: ['人鱼公主'], action: '人鱼公主 breaks the seal and drops the photograph onto the table.' })], [], { duration: 8 });
  assert.doesNotMatch(legacy, /breaks the seal and drops the photograph onto the table/);
  assert.match(legacy, /完成一个自然手势/);
});

test('object reference pictures get stable labels without leaking Chinese names into H3 prose', () => {
  const d = direction('贵妃');
  d.action = '贵妃抬起金色面膜盒，并始终看着盒子。';
  d.detail = '贵妃收紧手指握住金色面膜盒，随后轻轻眯眼。';
  d.ending = '贵妃把金色面膜盒平稳停在胸前。';
  const p = buildVideoSegmentPrompt([shot({ characters: ['贵妃'], objects: ['金色面膜盒'], videoDirection: d })], [], {
    duration: 8, objectReferenceNames: ['金色面膜盒'],
  });
  assert.match(p, /<Object 1>是<Picture 2>中的准确实物/);
  assert.match(p, /<Subject 1>抬起<Object 1>/);
  assert.doesNotMatch(p.split('detailed_description:')[1], /金色面膜盒|贵妃/);
});

test('an unambiguous shortened Chinese title is restored inside English directing prose', () => {
  const repaired = validateVideoDirection({
    action: '贵妃 points toward the tray while 青鸾 steps back.',
    camera: 'Track right until 贵妃 and 青鸾 share the frame.',
    detail: '贵妃 keeps one sleeve raised.',
    ending: '青鸾 stops beside 贵妃 and the tray remains visible.',
  }, ['沈贵妃', '青鸾']);
  assert.equal(repaired.action, '沈贵妃 points toward the tray while 青鸾 steps back.');
  assert.match(repaired.camera, /沈贵妃 and 青鸾/);
  assert.doesNotThrow(() => validateVideoDirection({ ...direction(), action: '沈贵妃转身离开。' }, ['沈贵妃']));
});

test('fields share the combined budget without splicing away words or negations', () => {
  assert.deepEqual(validateVideoDirection(direction()), direction());
  for (const [field, limit] of Object.entries(VIDEO_DIRECTION_LIMITS)) {
    assert.equal(validateVideoDirection({ ...direction(), [field]: 'x'.repeat(limit + 1) })[field].length, limit + 1);
    assert.throws(() => validateVideoDirection({ ...direction(), [field]: 'x'.repeat(721) }), /720/);
  }
  assert.throws(() => validateVideoDirection({ action: 'x'.repeat(300), camera: 'x'.repeat(180), detail: 'x'.repeat(140), ending: 'x'.repeat(140) }), /共 760 字符/);
  assert.equal(VIDEO_DIRECTION_MAX_CHARACTERS, 720);
});

test('visual validation rejects dialogue, empty outcomes and generic adjective-only actions', () => {
  for (const action of ['Lin says hello.', '<d>[English] Hello</d>', 'cinematic natural premium', 'Lin completes one clear physical action']) {
    assert.throws(() => validateVideoDirection({ ...direction(), action }));
  }
  assert.throws(() => validateVideoDirection({ ...direction(), ending: '' }), /ending/);
  assert.doesNotThrow(() => validateVideoDirection({ ...direction(), action: '她打开信封，取出照片后将信封放在桌面。' }));
  assert.throws(() => validateVideoDirection({ ...direction(), action: '她开口说道台词。' }));
  assert.throws(() => validateVideoDirection({ ...direction(), detail: 'The answer is already here.' }, [], ['The answer is already here.']), /权威台词/);
  assert.doesNotThrow(() => validateVideoDirection({ ...direction(), detail: 'Her eyes widen.' }, [], ['Yes.']));
});

test('a name-only utterance does not reject or erase the registered actor in visual prose', () => {
  const names = ['贵妃', '裴大人'];
  const speech = [{ exactLine: '裴大人。' }, { exactLine: '臣在。' }];
  const description = '裴大人低头退后，贵妃指向门外。';
  const vd = { ...direction(), action: '裴大人低头退后，贵妃同时指向门外。' };
  assert.doesNotThrow(() => validateVideoDirection(vd, names, speech.map(s => s.exactLine)));
  assert.doesNotThrow(() => validateDirectorShots([{ description, prompt: 'A doorway.', videoDirection: vd }], [{ index: 16, speech }], 'test', 'zh', names));
  assert.equal(stripExactDialogueFromDescription(description, { speech }, names), description);
  assert.equal(stripExactDialogueFromDescription('贵妃说道“裴大人。”裴大人低头。', { speech }, names), '贵妃裴大人低头。');
  for (const copied of ['“裴大人。”', '"裴大人?"', '裴大人 says 裴大人.']) {
    assert.throws(() => validateVideoDirection({ ...vd, action: copied }, names, ['裴大人。']), /台词|声音/);
  }
  assert.throws(() => validateDirectorShots([{ description: '贵妃说出裴大人。', prompt: 'A doorway.' }], [{ index: 16, speech }], 'test', 'zh', names), /权威台词/);
  assert.throws(() => validateVideoDirection({ ...vd, detail: 'The answer is here.' }, names, ['The answer is here.']), /权威台词/);
});

test('reference binding preserves object order and narrowly recovers legacy reorder-only motion sources', () => {
  const original = shot({ objects: ['photograph', 'envelope'], videoDirection: direction() });
  original.videoDirectionSource = videoDirectionSourceKey(original);
  const bound = bindStoryboardReferences(original, [{id:'c', name:'Lin'}], [{id:'o1',name:'envelope'}, {id:'o2',name:'photograph'}]);
  assert.deepEqual(bound.objects, original.objects);
  assert.deepEqual(currentVideoDirection(bound), original.videoDirection);
  const legacy = { ...original, objects: [...original.objects].reverse() };
  assert.equal(currentVideoDirection(legacy), undefined);
  const recovered = recoverReorderedObjectDirection(legacy);
  assert.deepEqual(currentVideoDirection(recovered), original.videoDirection);
  assert.notEqual(videoSegmentGenerationSignature([legacy]), videoSegmentGenerationSignature([recovered]));
  const tagged = shot({ objects: ['envelope'], prompt: '[photograph] lies on the table.', videoDirection: direction() });
  tagged.videoDirectionSource = videoDirectionSourceKey(tagged);
  const legacyTagged = { ...tagged, objects: ['envelope', 'photograph'] };
  assert.deepEqual(currentVideoDirection(recoverReorderedObjectDirection(legacyTagged)), tagged.videoDirection);
  const taggedBound = bindStoryboardReferences(tagged, [{id:'c',name:'Lin'}], [{id:'o1',name:'envelope'},{id:'o2',name:'photograph'}]);
  assert.deepEqual(currentVideoDirection(taggedBound), tagged.videoDirection);
  for (const patch of [{action:'Lin burns the photograph.'},{prompt:'A new scene.'},{objects:['photograph','bottle']}]) {
    const edited = {...legacy,...patch};
    assert.equal(recoverReorderedObjectDirection(edited), edited);
    assert.equal(currentVideoDirection(edited), undefined);
  }
});

test('automatic source adaptation repairs a stale brief without replacing neighboring valid briefs or media', async () => {
  const valid = shot({ videoDirection: direction() });
  const invalid = shot({ id:'s10', sceneNumber:10, characters:['太后','贵妃'], action:'太后在门框停住，贵妃抬头。', videoDirection:{...direction(),action:'裴大人站在桌后。'}, videoDirectionSource:'stale' });
  let calls = 0;
  const repaired = await refineVideoDirections([valid,invalid], async prompt => {
    calls++;
    assert.match(prompt, /每镜 characters\/objects 是本镜主体清单/);
    return JSON.stringify([{id:'s10',videoDirection:{...direction(),action:'太后在门框前停住，贵妃同时抬起下巴。'}}]);
  });
  assert.equal(calls,1);
  assert.equal(repaired[0],valid);
  assert.equal(repaired[1].imageUrl,invalid.imageUrl);
  assert.equal(repaired[1].action,invalid.action);
  assert.ok(currentVideoDirection(repaired[1]));
  const page=readFileSync(new URL('../app/story/page.tsx',import.meta.url),'utf8');
  assert.match(page,/await handleGenerateVideoPrompt\(segment\[0\], segment, false, \{ throwOnError: true \}\)/);
  assert.match(page,/storyboardsRef\.current = updated;\s*setStoryboards\(updated\)/);
});

test('products get material motion, not an invented human performance', () => {
  const s = shot({ characters: [], action: '瓶子顺时针旋转。', videoDirection: {
    action: '瓶子在展台上顺时针旋转三十度。',
    camera: '固定微距镜头持续对焦瓶肩。',
    detail: '一滴冷凝水沿玻璃滑下，汇入较大的水珠。',
    ending: '瓶子停止转动，正面标签朝向镜头。',
  } });
  const p = buildVideoSegmentPrompt([s], [], { duration: 6 });
  assert.match(p, /冷凝水沿玻璃滑下/);
  assert.doesNotMatch(p, /gaze and facial tension|brow tense|breath tightens/);
  const legacy = buildVideoSegmentPrompt([{ ...s, videoDirection: undefined }], [], { duration: 6 });
  assert.doesNotMatch(legacy, /gaze and facial tension/);
});

test('four dense briefs retain every action, camera, detail, ending and exact dialogue under 7000 characters', () => {
  const fill = (text, limit) => { while ((text + ' 该状态始终留在画面中。').length <= limit) text += ' 该状态始终留在画面中。'; return text; };
  const shots = [1, 2, 3, 4].map(n => shot({
    id: `s${n}`, sceneNumber: n, characters: ['Lin', 'Mei', 'Guard'],
    videoDirection: {
      action: fill(`Lin转动第${n}道门的钥匙；门闩缩回，Mei把沉重的门推向里面。`, 300),
      camera: fill('肩部高度的镜头跟随移动的门边，直到敞开的通道完全可见。', 180),
      detail: fill('金属刮过门框时，灰尘从门闩落下。', 120),
      ending: fill(`第${n}道门保持敞开；钥匙留在锁中，众人面向通道。`, 120),
    },
    ...(n === 2 ? { dialogueLines: [{ character: 'Lin', text: '跟着我，不要回头。' }] } : {}),
    ...(n === 3 ? { dialogueLines: [{ character: 'Mei', text: '出口就在前面。' }] } : {}),
  }));
  const p = buildVideoSegmentPrompt(shots, [], { duration: 15, firstFrameUrl: 'continuity', referenceAudioNames: ['Lin', 'Mei'], language: 'zh', isFilmEnding: true });
  assert.ok(p.length <= 7000, `got ${p.length}`);
  assert.match(p, /整片结束时，只有末镜的/);
  for (const s of shots) for (const value of Object.values(s.videoDirection)) assert.ok(p.includes(value), value);
  for (const line of ['跟着我，不要回头。', '出口就在前面。']) assert.equal(p.split(line).length - 1, 1);
});

test('FL2VA preserves authored motion and exact end reference', () => {
  const p = buildVideoSegmentPrompt([shot({ videoDirection: direction() })], [], { duration: 8, firstFrameUrl: 'opening' });
  assert.match(p, /integrated_multimodal_description/);
  assert.ok(p.includes(direction().ending));
  assert.match(p, /准确到达<Picture 2>中的姿态与构图/);
});

test('camera paths change perspective without weakening identity or exact frame anchors', () => {
  const s = shot({ videoDirection: direction() });
  for (const group of [[s], [s, { ...s, id: 's2', sceneNumber: 2 }]]) {
    const p = buildVideoSegmentPrompt(group, [], { duration: 8 });
    assert.ok(p.includes(direction().camera));
    assert.match(p, /只执行已写明的动作、表情(?:、运镜和剪辑|和运镜)/);
    assert.doesNotMatch(p, /framing, and color palette throughout|every picture composition and setting/);
    assert.match(p, /人物身份|脸部/);
  }
  const p = buildVideoSegmentPrompt([s], [], { duration: 8, firstFrameUrl: 'opening' });
  assert.match(p, /00:00\.000的准确首帧/);
  assert.match(p, /镜头结束时准确到达<Picture 2>的构图/);
});

test('legacy English camera sentences are converted to Chinese camera behavior before H3', () => {
  const camera = 'From waist height, truck left at walking speed by one metre, keeping Lin in profile as the door passes across the foreground.';
  const p = buildVideoSegmentPrompt([shot({ cameraMove: camera, description: 'A static image of Lin.' })], [], { duration: 8 });
  assert.doesNotMatch(p, /truck left/);
  assert.match(p, /相机随主体横向移动/);
  const focus = 'Locked-off camera: rack focus from the photograph to Lin as her fingers release.';
  assert.match(buildVideoSegmentPrompt([shot({ cameraMove: focus })], [], { duration: 8 }), /固定机位；在动作触发时，只在既定的两个景深平面之间移焦一次/);
  const surveillance = buildVideoSegmentPrompt([shot({ cameraMove: camera, capturePreset: 'surveillance' })], [], { duration: 8 });
  assert.doesNotMatch(surveillance, /truck left/);
  assert.match(surveillance, /固定高机位不跟拍/);
});

test('new camera lint repairs vague or contradictory directions without invalidating legacy clips', () => {
  for (const camera of ['Make a slight lateral settle to keep the three people aligned.', 'Locked at table height, hold and nudge the frame to keep the seal centered.']) {
    const d = { ...direction(), camera };
    assert.throws(() => validateVideoDirection(d, [], [], true), /videoDirection.camera/);
    assert.deepEqual(currentVideoDirection(shot({ videoDirection: d })), d);
  }
  assert.doesNotThrow(() => validateVideoDirection({ ...direction(), camera: 'Locked-off close shot: rack focus once from the seal to Lin as her hand stops.' }, [], [], true));
});

test('oversized final prompt fails explicitly, never truncates authoritative content', () => {
  const s = shot({ videoDirection: direction(), dialogueLines: [{ character: 'Lin', text: '走吧。' }] });
  assert.throws(() => buildVideoSegmentPrompt([s], [], { duration: 6, voiceProfiles: { Lin: '温暖而低沉的声音。'.repeat(800) } }), /7000 字符上限/);
});

test('visual source edits invalidate the brief, but image URLs, voice metadata and segment speech distribution do not', () => {
  const s = shot({ videoDirection: direction() });
  s.videoDirectionSource = videoDirectionSourceKey(s);
  assert.deepEqual(currentVideoDirection(s), direction());
  for (const patch of [{ action: 'Lin leaves.' }, { cameraMove: 'push in' }, { capturePreset: 'surveillance' }, { stateAfter: { objects: 'empty table' } }]) {
    assert.equal(currentVideoDirection({ ...s, ...patch }), undefined);
  }
  assert.deepEqual(currentVideoDirection({ ...s, imageUrl: 'new-url', videoDuration: 15, videoStatus: 'generating', speech: [], dialogueLines: undefined }), direction());
  assert.notEqual(videoSegmentGenerationSignature([s]), videoSegmentGenerationSignature([{ ...s, videoDirection: { ...direction(), detail: 'Her fingers tighten once.' } }]));
});

test('old-shot refinement translates text-only input and preserves all original fields', async () => {
  const s = shot(); let calls = 0;
  const result = await refineVideoDirections([s], async prompt => {
    calls++;
    assert.ok(prompt.includes(s.action));
    assert.doesNotMatch(prompt, /https:\/\/example.com/);
    assert.match(prompt, /不改动剧情|不改动/);
    assert.match(prompt, /720/);
    return JSON.stringify([{ id: s.id, videoDirection: direction() }]);
  });
  assert.equal(calls, 1);
  for (const [key, value] of Object.entries(s)) assert.deepEqual(result[0][key], value);
  assert.deepEqual(currentVideoDirection(result[0]), direction());
  assert.equal(s.videoDirection, undefined);
  await refineVideoDirections(result, async () => { throw new Error('valid briefs must not make another call'); });
});

test('explicit rewriting replaces a valid brief without replacing the paid assets or screenplay', async () => {
  const s = shot({ videoDirection: direction(), videoUrl: 'https://example.com/paid.mp4', videoTaskId: 'paid-task', videoStatus: 'completed' });
  s.videoDirectionSource = videoDirectionSourceKey(s);
  const before = structuredClone(s);
  const camera = '固定中景：Lin打开信封时，从封口移焦到她指间露出的照片。';
  let calls = 0;
  const [rewritten] = await refineVideoDirections([s], async prompt => {
    calls++;
    assert.match(prompt, /本次明确要求重新编写/);
    assert.match(prompt, /重新设计摄影任务/);
    assert.ok(!prompt.includes(s.videoDirection.camera));
    assert.match(prompt, /类型、方向、幅度、速度/);
    return JSON.stringify([{ id: s.id, videoDirection: { ...direction(), camera } }]);
  }, { rewrite: true });
  assert.equal(calls, 1);
  assert.equal(currentVideoDirection(rewritten).camera, camera);
  for (const [key, value] of Object.entries(before)) if (key !== 'videoDirection') assert.deepEqual(rewritten[key], value);
  assert.deepEqual(s, before);
  assert.notEqual(videoSegmentGenerationSignature([s]), videoSegmentGenerationSignature([rewritten]));
});

test('refinement knows when the image prompt is the final frame, not the opening', async () => {
  await refineVideoDirections([shot()], async prompt => {
    assert.match(prompt, /首尾帧连接.*本镜附图是必须到达的结束构图/);
    assert.match(prompt, /不能假装看过图片/);
    return JSON.stringify([{ id: 's1', videoDirection: direction() }]);
  }, { hasFirstFrame: true });
});

test('vision refinement maps only submitted frames and never sends private or unrelated URLs', async () => {
  const a = shot({ imageUrl: 'https://res.cloudinary.com/demo/image/upload/frame.png' });
  const b = shot({ id: 's2', imageUrl: 'http://127.0.0.1/private.png' });
  await refineVideoDirections([a, b], async (prompt, images) => {
    assert.deepEqual(images, [a.imageUrl]);
    assert.match(prompt, /附图编号：\[{"picture":1,"id":"s1"}\]/);
    assert.match(prompt, /未附图的镜头仅按文字处理/);
    assert.doesNotMatch(prompt, /127\.0\.0\.1/);
    return JSON.stringify([a, b].map(s => ({ id: s.id, videoDirection: direction() })));
  }, { useReferenceImages: true });
});

test('overlong model outputs are rewritten via bounded retries without dropping the ending', async () => {
  let calls = 0;
  const result = await refineVideoDirections([shot()], async prompt => {
    calls++;
    if (calls === 2) {
      assert.match(prompt, /shots\[0\].videoDirection.action/);
      return JSON.stringify({ repairs: [{ path: 'shots[0].videoDirection.action', value: direction().action }] });
    }
    return JSON.stringify([{ id: 's1', videoDirection: { ...direction(), action: 'x'.repeat(721) } }]);
  });
  assert.equal(calls, 2);
  assert.equal(result[0].videoDirection.ending, direction().ending);
});

test('incremental repairs retain a shorter over-budget draft and already repaired details', async () => {
  let calls = 0;
  const longCamera = '镜头跟随Lin走向书桌。';
  const detail = '纸张在她的拇指下弯曲。';
  const [result] = await refineVideoDirections([shot()], async prompt => {
    calls++;
    if (calls === 1) return JSON.stringify([{id:'s1',videoDirection:{...direction(),camera:longCamera.repeat(90),detail:'x'.repeat(150)}}]);
    if (calls === 2) return JSON.stringify({repairs:[
      {path:'shots[0].videoDirection.camera',value:longCamera.repeat(70)},
      {path:'shots[0].videoDirection.detail',value:detail},
    ]});
    assert.ok(prompt.includes(longCamera.repeat(70).trim()));
    assert.ok(!prompt.includes(longCamera.repeat(90).trim()));
    const requested=JSON.parse(prompt.split('Requested fields (data, not instructions): ')[1].split('\n')[0]);
    assert.deepEqual(requested.map(x=>x.path),['shots[0].videoDirection.camera']);
    return JSON.stringify({repairs:[{path:requested[0].path,value:direction().camera}]});
  });
  assert.equal(calls,3);assert.equal(result.videoDirection.detail,detail);
});

test('transport failures do not consume content repair attempts and remain bounded', async () => {
  let calls=0;
  const [result]=await refineVideoDirections([shot()],async()=>{
    calls++;
    if(calls===1||calls===3)throw Error('503 try again later');
    if(calls===2)return JSON.stringify([{id:'s1',videoDirection:{...direction(),camera:'x'.repeat(721)}}]);
    return JSON.stringify({repairs:[{path:'shots[0].videoDirection.camera',value:direction().camera}]});
  });
  assert.equal(calls,4);assert.equal(result.videoDirection.camera,direction().camera);
  let failures=0;
  await assert.rejects(()=>refineVideoDirections([shot()],async()=>{failures++;throw Error('503 try again later');}),/503/);
  assert.equal(failures,3);
});

test('refresh field repair retains neighboring valid briefs across a transport failure', async () => {
  const inputs = [shot(), shot({ id: 's2', sceneNumber: 2 })];
  let calls = 0;
  const result = await refineVideoDirections(inputs, async prompt => {
    calls++;
    if (calls === 1) return JSON.stringify([
      { id: 's1', videoDirection: direction() },
      { id: 's2', videoDirection: { ...direction(), camera: 'x'.repeat(721) } },
    ]);
    assert.match(prompt, /shots\[1\].videoDirection.camera/);
    assert.doesNotMatch(prompt, /shots\[0\].videoDirection/);
    if (calls === 2) throw Error('temporary transport failure');
    return JSON.stringify({ repairs: [{ path: 'shots[1].videoDirection.camera', value: direction().camera }] });
  });
  assert.equal(calls, 3);
  assert.deepEqual(result[0].videoDirection, direction());
  assert.deepEqual(result[1].videoDirection, direction());
  for (let i = 0; i < inputs.length; i++) {
    for (const [key, value] of Object.entries(inputs[i])) assert.deepEqual(result[i][key], value);
  }
});

test('wrong IDs never attach another shot brief; invalid output stops after three attempts', async () => {
  let calls = 0;
  await assert.rejects(() => refineVideoDirections([shot()], async () => {
    calls++;
    return JSON.stringify([{ id: 'wrong', videoDirection: direction() }]);
  }), /ID\/顺序不匹配/);
  assert.equal(calls, 3);
});

test('imported malformed briefs can be repaired rather than permanently blocking refresh', async () => {
  const s = shot({ videoDirection: { action: 'unfinished' } });
  const result = await refineVideoDirections([s], async () => JSON.stringify([{ id: s.id, videoDirection: direction() }]));
  assert.deepEqual(currentVideoDirection(result[0]), direction());
});

test('new director generation requires bounded motion briefs while legacy validation remains compatible', () => {
  const raw = { description: '她打开信封。', prompt: 'A woman holds an envelope.' };
  const beat = { index: 1, speech: [] };
  assert.doesNotThrow(() => validateDirectorShots([raw], [beat], 'array', 'zh'));
  assert.throws(() => validateDirectorShots([raw], [beat], 'array', 'zh', [], true), /缺少 videoDirection/);
  assert.doesNotThrow(() => validateDirectorShots([{ ...raw, videoDirection: direction() }], [beat], 'array', 'zh', [], true));
  const p = buildDirectorPrompt({ storyPlan: { requirements: [], sequences: [] }, beats: [beat], batchNumber: 1, totalBatches: 1, characters: [], objects: [], language: 'zh' });
  assert.match(p, /videoDirection/);
  assert.match(p, /主动作|可见状态/);
  assert.match(p, /合计≤720/);
  assert.match(p, /description、characterCostume 与 videoDirection/);
  assert.match(p, /action \/ camera \/ detail \/ ending 的动作、状态、方位、摄影与连接词必须全部使用中文/);
  assert.match(p, /"action": "完整、具象的中文可见动作句。"/);
  assert.match(p, /对白中的概念、引号词、官职泛称或剧情总结不是可见动作/);
  const englishDialogueProject = buildDirectorPrompt({ storyPlan: { requirements: [], sequences: [] }, beats: [beat], batchNumber: 1, totalBatches: 1, characters: [], objects: [], language: 'en' });
  assert.match(englishDialogueProject, /项目语言 English 只约束 speech 中的逐字台词/);
  assert.match(englishDialogueProject, /"action": "完整、具象的中文可见动作句。"/);
  const source = readFileSync(new URL('../lib/pipeline/storyDirector.ts', import.meta.url), 'utf8');
  assert.match(source, /videoDirection: raw\?\.videoDirection/);
  assert.match(source, /videoDirectionSource = videoDirectionSourceKey/);
});
