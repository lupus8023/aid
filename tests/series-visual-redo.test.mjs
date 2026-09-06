import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resetSeriesVisualProduction, refreshVisualRedoProduction } from '../lib/series/visualRedo.ts';
import { mergeRegeneratedVisualPrompts } from '../lib/visualPromptRewrite.ts';

function projectFixture() {
  const storyboards = [1, 2].map(sceneNumber => ({
    id: `shot-${sceneNumber}`,
    sceneNumber,
    description: `导演描述 ${sceneNumber}`,
    prompt: `分镜提示 ${sceneNumber}`,
    characters: ['自动角色', '指定角色'],
    status: 'completed',
    imageUrl: `https://old.test/shot-${sceneNumber}.png`,
    gridSourceUrl: 'https://old.test/grid.png',
    taskId: 'paid-image-task',
    videoStatus: 'completed',
    videoUrl: `blob:old-${sceneNumber}`,
    videoSourceUrl: `https://old.test/video-${sceneNumber}.mp4`,
    videoTaskId: 'paid-video-task',
    videoPrompt: 'old compiled H3 prompt',
    videoPromptOverride: true,
    characterAudios: [{ character: '自动角色', audioUrl: 'https://voice.test/line.mp3' }],
  }));
  const script = [1, 2].map(number => ({
    number,
    seconds: 5,
    locationId: 'l1',
    characterIds: ['c1', 'c2'],
    objectIds: ['o1', 'o2'],
    visual: `镜头画面 ${number}`,
    action: `演员动作 ${number}`,
    dialogue: [],
    sound: '环境声',
    purpose: '推进剧情',
  }));
  return {
    id: 'series-redo', revision: 3, name: '重做测试', brief: '故事', genre: '宫廷',
    episodeCount: 1, shotCount: 2, durationSeconds: 10, language: 'zh', aspectRatio: '9:16',
    visualStyle: 'cinematic-natural', paused: false, createdAt: '', updatedAt: '',
    bible: { theme: '主题' },
    characters: [
      { id: 'c1', name: '自动角色', aliases: [], role: '主角', description: '宋代宫装', want: '', secret: '', arc: '', voiceBrief: '', speaking: true, appearance: 'on_screen', importance: 'lead', locked: true, version: 1, imageSource: 'auto', imageUrl: 'https://old.test/auto.png', bibleUrl: 'https://old.test/auto.png', visualIdentity: { description: '旧角色图事实' }, imageTaskId: 'paid-card', voiceId: 'voice-1', voiceReferenceUrl: 'https://voice.test/c1.mp3' },
      { id: 'c2', name: '指定角色', aliases: [], role: '配角', description: '青衣', want: '', secret: '', arc: '', voiceBrief: '', speaking: false, appearance: 'on_screen', importance: 'supporting', locked: true, version: 1, imageSource: 'user', imageUrl: 'https://user.test/role.png', bibleUrl: 'https://user.test/role.png' },
    ],
    locations: [{ id: 'l1', name: '宫殿', description: '宋代宫殿', imageUrl: 'https://old.test/palace.png', imageTaskId: 'paid-location' }],
    objects: [
      { id: 'o1', name: '自动道具', aliases: [], description: '玉盏', imageUrl: 'https://old.test/cup.png', visualIdentity: { description: '旧道具图事实' }, referenceMode: 'auto', imageTaskId: 'paid-object' },
      { id: 'object-upload', name: '指定产品', aliases: [], description: '金色面膜盒', imageUrl: 'https://user.test/product.png', referenceMode: 'upload' },
    ],
    episodes: [{
      id: 'ep-1', number: 1, title: '第一集', synopsis: '', opening: '', goal: '', conflict: '', choice: '', resolution: '', hook: '', hookType: '', nextOpening: '', characterIds: ['c1', 'c2'], locationIds: ['l1'], plants: [], paysOff: [], stateChanges: [], knowledgeChanges: [], script, version: 2,
      deliveries: [{ id: 'old-film', fileName: 'old.mp4', createdAt: '', episodeVersion: 2, bytes: 123 }],
      production: { id: 'old-production', name: '旧制作', characters: [], objects: [], storyContent: '旧文本', storyOutline: '', storyboards, costumeImages: { 自动角色: 'https://old.test/auto.png' }, sceneImages: ['https://old.test/palace.png'], createdAt: '', updatedAt: '' },
    }],
  };
}

test('one-click visual redo retains screenplay/shot intent, marks prompts for rewrite, and keeps voices, approved references and deliveries', () => {
  const project = projectFixture();
  const beforeScript = structuredClone(project.episodes[0].script);
  const beforePrompts = project.episodes[0].production.storyboards.map(board => board.prompt);
  const beforeAudios = structuredClone(project.episodes[0].production.storyboards.map(board => board.characterAudios));
  const summary = resetSeriesVisualProduction(project);

  assert.deepEqual(summary, { characters: 1, locations: 1, objects: 1, episodes: 1 });
  assert.equal(project.characters[0].bibleUrl, undefined);
  assert.equal(project.characters[0].imageUrl, '');
  assert.equal(project.characters[0].visualIdentity, undefined);
  assert.equal(project.characters[0].voiceId, 'voice-1');
  assert.equal(project.characters[0].voiceReferenceUrl, 'https://voice.test/c1.mp3');
  assert.equal(project.characters[1].bibleUrl, 'https://user.test/role.png');
  assert.equal(project.objects[0].imageUrl, '');
  assert.equal(project.objects[0].visualIdentity, undefined);
  assert.equal(project.objects[1].imageUrl, 'https://user.test/product.png');
  assert.equal(project.locations[0].imageUrl, undefined);
  assert.deepEqual(project.episodes[0].script, beforeScript);
  assert.deepEqual(project.episodes[0].production.storyboards.map(board => board.prompt), beforePrompts);
  assert.deepEqual(project.episodes[0].production.storyboards.map(board => board.characterAudios), beforeAudios);
  assert.ok(project.episodes[0].production.storyboards.every(board => !board.imageUrl && !board.videoUrl && board.status === 'pending' && board.videoStatus === 'pending'));
  assert.equal(project.episodes[0].production.storyboards[0].videoPrompt, undefined);
  assert.ok(project.episodes[0].production.storyboards.every(board => board.visualPromptRewriteId));
  assert.equal(new Set(project.episodes[0].production.storyboards.map(board => board.visualPromptRewriteId)).size, 1);
  assert.equal(project.episodes[0].production.videoSegmentPlan, undefined);
  assert.equal(project.episodes[0].visualRedoPending, true);
  assert.equal(project.episodes[0].version, 3);
  assert.equal(project.episodes[0].deliveries[0].id, 'old-film');
  assert.equal(project.visualHistory.at(-1).reason, 'manual_visual_redo');
  assert.equal(project.visualHistory.at(-1).productions[0].production.storyboards[0].imageUrl, 'https://old.test/shot-1.png');
});

test('retained storyboards receive newly generated master references while awaiting prompt rewrite', () => {
  const project = projectFixture();
  resetSeriesVisualProduction(project);
  project.characters[0].bibleUrl = project.characters[0].imageUrl = 'https://new.test/auto.png';
  project.characters[0].locked = true;
  project.locations[0].imageUrl = 'https://new.test/palace.png';
  project.objects[0].imageUrl = 'https://new.test/cup.png';
  const episode = project.episodes[0];
  const prompts = episode.production.storyboards.map(board => board.prompt);
  const refreshed = refreshVisualRedoProduction(project, episode);
  assert.deepEqual(refreshed.storyboards.map(board => board.prompt), prompts);
  assert.ok(refreshed.storyboards.every(board => board.visualPromptRewriteId));
  assert.equal(refreshed.videoSegmentPlan, undefined);
  assert.equal(refreshed.costumeImages['自动角色'], 'https://new.test/auto.png');
  assert.deepEqual(refreshed.sceneImages, ['https://new.test/palace.png']);
  assert.equal(refreshed.objects.find(object => object.id === 'o1').imageUrl, 'https://new.test/cup.png');
});

test('visual prompt rewrite replaces image/H3 execution text but preserves approved shot authority and audio', () => {
  const project = projectFixture();
  resetSeriesVisualProduction(project);
  const retained = project.episodes[0].production.storyboards;
  retained[0].action = '锁定动作';
  retained[0].shotSize = '中景';
  retained[0].cameraMove = '缓慢推近';
  retained[0].speech = [{ character: '自动角色', exactLine: '逐字台词', emotion: '克制', startTime: 0, endTime: 2 }];
  const regenerated = retained.map((board, index) => ({
    ...board,
    description: `新导演画面 ${index + 1}`,
    prompt: `new image prompt ${index + 1}`,
    videoDirection: { action: `新动作提示 ${index + 1}`, camera: '新摄影提示', detail: '', ending: '新镜尾提示' },
    videoDirectionSource: `fresh-${index + 1}`,
    action: '模型不应覆盖的动作',
    shotSize: '模型不应覆盖的景别',
    speech: [],
    characterAudios: [],
  }));
  const rewritten = mergeRegeneratedVisualPrompts(retained, regenerated);
  assert.equal(rewritten[0].prompt, 'new image prompt 1');
  assert.equal(rewritten[0].videoDirection.action, '新动作提示 1');
  assert.equal(rewritten[0].action, '锁定动作');
  assert.equal(rewritten[0].shotSize, '中景');
  assert.equal(rewritten[0].cameraMove, '缓慢推近');
  assert.equal(rewritten[0].speech[0].exactLine, '逐字台词');
  assert.equal(rewritten[0].characterAudios[0].audioUrl, 'https://voice.test/line.mp3');
  assert.equal(rewritten[0].visualPromptRewriteId, undefined);
  assert.equal(rewritten[0].videoPrompt, undefined);
});

test('series UI and Companion advertise the visual redo contract', async () => {
  const [page, route, status, worker, story, directorRoute] = await Promise.all([
    readFile(new URL('../app/series/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/companion/series/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/companion/status/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/series/worker/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/story/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/direct-storyboard/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /一键重做/);
  assert.match(page, /重写生图\/H3 提示词/);
  assert.match(route, /case "redo-visuals"/);
  assert.match(route, /IMAGE_PREPARATION_PENDING/);
  assert.match(worker, /errorCode/);
  assert.match(story, /visualPromptRewriteId/);
  assert.match(directorRoute, /generationRevision/);
  assert.match(status, /seriesVisualRedo: true/);
  assert.match(status, /seriesVisualPromptRewrite: true/);
});

test('redo accepts complete screenplays with missing or partial director drafts and rebuilds after masters', () => {
  for (const mode of ['missing', 'partial', 'empty']) {
    const project = projectFixture();
    const episode = project.episodes[0];
    const script = structuredClone(episode.script);
    const deliveries = structuredClone(episode.deliveries);
    if (mode === 'missing') episode.production = undefined;
    else episode.production.storyboards = mode === 'empty' ? [] : episode.production.storyboards.slice(0, 1);
    resetSeriesVisualProduction(project);
    assert.deepEqual(episode.script, script);
    assert.deepEqual(episode.deliveries, deliveries);
    assert.equal(episode.production, undefined);
    assert.equal(episode.visualRedoPending, true);
    // Preparation has finished; missing directors enter the ordinary Story path.
    project.characters.forEach(character => { character.locked = true; character.imageUrl = 'https://new.test/master.png'; });
    const fresh = refreshVisualRedoProduction(project, episode);
    assert.deepEqual(fresh.storyboards, []);
    assert.ok(fresh.storyContent.includes('镜头画面 1'));
    assert.equal(fresh.characters[0].imageUrl, 'https://new.test/master.png');
  }
});

test('redo rejects missing screenplay before changing images or history', () => {
  const project = projectFixture();
  project.episodes[0].script = undefined;
  const before = structuredClone(project);
  assert.throws(() => resetSeriesVisualProduction(project), /分镜文本/);
  assert.deepEqual(project, before);
});
