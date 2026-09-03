import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildVideoSegmentPrompt, H3_PROMPT_MAX_CHARACTERS } from '../lib/videoGenerator.ts';
import { currentVideoDirection, validateVideoDirection, videoDirectionSourceKey, VIDEO_DIRECTION_LIMITS, VIDEO_DIRECTION_MAX_CHARACTERS } from '../lib/videoDirection.ts';
import { refineVideoDirections } from '../lib/pipeline/videoDirection.ts';
import { validateDirectorShots, buildDirectorPrompt } from '../lib/pipeline/storyDirector.ts';
import { videoSegmentGenerationSignature } from '../lib/videoSegments.ts';

const direction = (name = 'Lin') => ({
  action: `${name} breaks the envelope seal and draws out the photograph; her right hand loosens as she sees it.`,
  camera: 'A waist-height medium shot arcs clockwise by 90 degrees, stopping when the photograph touches the table.',
  detail: 'Her smile fades before her fingers release; her left hand does not move.',
  ending: 'The photograph lands face-up on the table while her right hand remains suspended.',
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
  assert.match(p, /From 00:00\.000 to 00:08\.000/);
  assert.ok(p.length <= H3_PROMPT_MAX_CHARACTERS);
});

test('registered Chinese names are bound without discarding the English action or ending', () => {
  const d = direction('人鱼公主');
  const p = buildVideoSegmentPrompt([shot({ characters: ['人鱼公主'], videoDirection: d })], [], { duration: 8 });
  assert.match(p, /<Subject 1> breaks the envelope seal/);
  assert.ok(p.includes(d.ending));
  assert.doesNotMatch(p, /[\u3400-\u9fff]/);
  const legacy = buildVideoSegmentPrompt([shot({ characters: ['人鱼公主'], action: '人鱼公主 breaks the seal and drops the photograph onto the table.' })], [], { duration: 8 });
  assert.match(legacy, /breaks the seal and drops the photograph onto the table/);
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
  assert.throws(() => validateVideoDirection({ ...direction(), action: '沈贵妃转身离开。' }, ['沈贵妃']), /必须用英文/);
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
  assert.throws(() => validateVideoDirection({ ...direction(), action: '她打开信封，取出照片后将信封放在桌面。' }), /必须用英文/);
  assert.throws(() => validateVideoDirection({ ...direction(), action: '她开口说道台词。' }));
  assert.throws(() => validateVideoDirection({ ...direction(), detail: 'The answer is already here.' }, [], ['The answer is already here.']), /权威台词/);
  assert.doesNotThrow(() => validateVideoDirection({ ...direction(), detail: 'Her eyes widen.' }, [], ['Yes.']));
});

test('products get material motion, not an invented human performance', () => {
  const s = shot({ characters: [], action: 'A bottle rotates clockwise.', videoDirection: {
    action: 'The bottle rotates clockwise by 30 degrees on its pedestal.',
    camera: 'The fixed macro camera holds the bottle shoulder in focus.',
    detail: 'One condensation bead slides down the glass and joins a larger droplet.',
    ending: 'The bottle stops with the front panel facing the lens.',
  } });
  const p = buildVideoSegmentPrompt([s], [], { duration: 6 });
  assert.match(p, /condensation bead slides/);
  assert.doesNotMatch(p, /gaze and facial tension|brow tense|breath tightens/);
  const legacy = buildVideoSegmentPrompt([{ ...s, videoDirection: undefined }], [], { duration: 6 });
  assert.doesNotMatch(legacy, /gaze and facial tension/);
});

test('four dense briefs retain every action, camera, detail, ending and exact dialogue under 7000 characters', () => {
  const fill = (text, limit) => { while ((text + ' It stays in view.').length <= limit) text += ' It stays in view.'; return text; };
  const shots = [1, 2, 3, 4].map(n => shot({
    id: `s${n}`, sceneNumber: n, characters: ['Lin', 'Mei', 'Guard'],
    videoDirection: {
      action: fill(`Lin turns the key at gate ${n}; the latch retracts and Mei pushes the heavy door inward.`, 300),
      camera: fill('The shoulder-height camera tracks the moving door edge until the open passage becomes visible.', 180),
      detail: fill('Dust falls from the latch as metal scrapes against the frame.', 120),
      ending: fill(`Gate ${n} remains open; the key stays in the lock and the group faces the passage.`, 120),
    },
    ...(n === 2 ? { dialogueLines: [{ character: 'Lin', text: '跟着我，不要回头。' }] } : {}),
    ...(n === 3 ? { dialogueLines: [{ character: 'Mei', text: '出口就在前面。' }] } : {}),
  }));
  const p = buildVideoSegmentPrompt(shots, [], { duration: 15, firstFrameUrl: 'continuity', referenceAudioNames: ['Lin', 'Mei'], language: 'zh', isFilmEnding: true });
  assert.ok(p.length <= 7000, `got ${p.length}`);
  assert.match(p, /FILM ENDING:/);
  for (const s of shots) for (const value of Object.values(s.videoDirection)) assert.ok(p.includes(value), value);
  for (const line of ['跟着我，不要回头。', '出口就在前面。']) assert.equal(p.split(line).length - 1, 1);
});

test('FL2VA preserves authored motion and exact end reference', () => {
  const p = buildVideoSegmentPrompt([shot({ videoDirection: direction() })], [], { duration: 8, firstFrameUrl: 'opening' });
  assert.match(p, /integrated_multimodal_description/);
  assert.ok(p.includes(direction().ending));
  assert.match(p, /reaches the pose and composition in <Picture 2>/);
});

test('camera paths change perspective without weakening identity or exact frame anchors', () => {
  const s = shot({ videoDirection: direction() });
  for (const group of [[s], [s, { ...s, id: 's2', sceneNumber: 2 }]]) {
    const p = buildVideoSegmentPrompt(group, [], { duration: 8 });
    assert.ok(p.includes(direction().camera));
    assert.match(p, /Framing, perspective, parallax, focus and occlusion may evolve continuously/);
    assert.doesNotMatch(p, /framing, and color palette throughout|every picture composition and setting/);
    assert.match(p, /identity|face/);
  }
  const p = buildVideoSegmentPrompt([s], [], { duration: 8, firstFrameUrl: 'opening' });
  assert.match(p, /exact first frame at 00:00\.000/);
  assert.match(p, /<Picture 2> is the exact required final frame/);
});

test('legacy camera sentences retain their actual path and fixed-camera focus transfers', () => {
  const camera = 'From waist height, truck left at walking speed by one metre, keeping Lin in profile as the door passes across the foreground.';
  const p = buildVideoSegmentPrompt([shot({ cameraMove: camera, description: 'A static image of Lin.' })], [], { duration: 8 });
  assert.ok(p.includes(camera));
  assert.doesNotMatch(p, /camera holds a static shot|small amplitude/);
  const focus = 'Locked-off camera: rack focus from the photograph to Lin as her fingers release.';
  assert.ok(buildVideoSegmentPrompt([shot({ cameraMove: focus })], [], { duration: 8 }).includes(focus));
  const surveillance = buildVideoSegmentPrompt([shot({ cameraMove: camera, capturePreset: 'surveillance' })], [], { duration: 8 });
  assert.doesNotMatch(surveillance, /truck left/);
  assert.match(surveillance, /fixed high camera never follows/);
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
  assert.throws(() => buildVideoSegmentPrompt([s], [], { duration: 6, voiceProfiles: { Lin: 'warm voice '.repeat(800) } }), /7000 字符上限/);
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
  const camera = 'Locked-off medium shot: as Lin opens the envelope, rack focus from the seal to the photograph emerging behind her fingers.';
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
  const longCamera = 'The camera follows Lin toward the desk. ';
  const detail = 'Paper bends under her thumb.';
  const [result] = await refineVideoDirections([shot()], async prompt => {
    calls++;
    if (calls === 1) return JSON.stringify([{id:'s1',videoDirection:{...direction(),camera:longCamera.repeat(20),detail:'x'.repeat(150)}}]);
    if (calls === 2) return JSON.stringify({repairs:[
      {path:'shots[0].videoDirection.camera',value:longCamera.repeat(14)},
      {path:'shots[0].videoDirection.detail',value:detail},
    ]});
    assert.ok(prompt.includes(longCamera.repeat(14).trim()));
    assert.ok(!prompt.includes(longCamera.repeat(20).trim()));
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
  const englishDialogueProject = buildDirectorPrompt({ storyPlan: { requirements: [], sequences: [] }, beats: [beat], batchNumber: 1, totalBatches: 1, characters: [], objects: [], language: 'en' });
  assert.match(englishDialogueProject, /项目语言 English 只约束 speech 中的逐字台词/);
  assert.match(englishDialogueProject, /"action": "中文因果动作"/);
  assert.doesNotMatch(englishDialogueProject, /videoDirection and characterCostume in ENGLISH/);
  const source = readFileSync(new URL('../lib/pipeline/storyDirector.ts', import.meta.url), 'utf8');
  assert.match(source, /videoDirection: raw\?\.videoDirection/);
  assert.match(source, /videoDirectionSource = videoDirectionSourceKey/);
});
