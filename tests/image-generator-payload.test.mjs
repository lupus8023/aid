import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { generateStoryboardImage } from '../lib/imageGenerator.ts';
import { buildGridPrompt } from '../lib/gridSplitter.ts';

test('silent tagged companions each receive their identity reference in a five-role GPT shot', async () => {
  const original = axios.post; let submitted;
  axios.post = async (_url, body) => { submitted = body; return { data: { data: [{ task_id: 'five-role-contract' }] } }; };
  try {
    const names = ['Victoria Tideborne', 'Luna Tideborne', 'Rill', 'Professor Silt', 'Tilda Trashfin'];
    const characters = names.map(name => ({ name, description: 'Approved distinct identity', imageUrl: `https://example.com/${encodeURIComponent(name)}.png` }));
    const shot = { id: 'scene-11', sceneNumber: 11, characters: names.slice(0, 3), prompt: '[Victoria Tideborne](crimson robes) faces [Luna Tideborne](blue coat), with [Professor Silt](seahorse scholar) and [Tilda Trashfin](patchwork vest) behind her. [Rill](eel courier) holds a shell.' };
    await generateStoryboardImage(shot, characters, 'test', [], '9:16', 'gpt-image-2', {}, 'https://example.com/hall.png', [], [], 'cinematic-natural', undefined, {}, '', {}, { imageUrl: 'https://example.com/style.png' });
    assert.match(submitted.prompt, /NAMED CAST \(5\)/);
    assert.equal(submitted.image_urls.length, 7);
    for (const character of characters) assert.ok(submitted.image_urls.includes(character.imageUrl));
    assert.match(submitted.prompt, /Reference image 6: ENVIRONMENT ONLY/);
    assert.match(submitted.prompt, /Reference image 7 is STYLE ONLY/);
    assert.deepEqual(shot.characters, names.slice(0, 3), 'image submission must not mutate caller state');
  } finally { axios.post = original; }
});

test('a named cast does not ban authored anonymous attendants or expand an empty shot', async () => {
  const original = axios.post; let submitted;
  axios.post = async (_url, body) => { submitted = body; return { data: { data: [{ task_id: 'cast-contract' }] } }; };
  try {
    const cast = [{ name: 'Luna', description: 'An elderly mermaid in a blue coat.', imageUrl: 'https://example.com/luna.png' }];
    for (const characters of [['Luna'], []]) {
      await generateStoryboardImage({ id:'shot', sceneNumber:1, characters, prompt: characters.length ? 'Luna waits in the foreground; anonymous attendants carry cloth in the background.' : 'An empty corridor after everyone has left.' }, cast, 'test', [], '9:16', 'gpt-image-2', {}, undefined, [], [], 'cinematic-natural');
      assert.match(submitted.prompt, /Anonymous background people are permitted only when explicitly described in the shot brief; otherwise no extras/);
      assert.doesNotMatch(submitted.prompt, /Show no other person|microcontrast|highlight roll-off|material response|radial iris fibers/);
      assert.match(submitted.prompt, new RegExp(`NAMED CAST \\(${characters.length}\\)`));
      assert.equal(submitted.n, 1);
      if (characters.length) assert.ok(submitted.prompt.includes('anonymous attendants carry cloth'));
    }
  } finally { axios.post = original; }
});

test('GPT image submission retains cast, every reference role and final constraints beyond 4K characters', async () => {
  const cast = ['Luna', 'Victoria', 'Silt'].map((name, i) => ({
    id: `c${i}`, name, description: `${name} has a distinct face, species and wardrobe.`,
    imageUrl: `https://example.com/${name}.png`,
  }));
  const board = {
    id: 'scene-1', sceneNumber: 1, characters: cast.map(c => c.name), objects: [],
    prompt: 'The three characters inspect an unopened scroll. ' + 'Carved coral columns surround the wet ceremonial chamber. '.repeat(65),
    action: 'Luna turns toward Victoria while Silt holds the closed scroll.',
    shotSize: 'medium wide', angle: 'eye level', cameraMove: 'static',
  };
  const originalPost = axios.post;
  let submitted;
  axios.post = async (_url, body) => {
    submitted = body;
    return { data: { code: 200, data: [{ task_id: 'task-preserved-contract' }] } };
  };
  try {
    const task = await generateStoryboardImage(board, cast, 'test-only', [], '9:16', 'gpt-image-2', {}, 'https://example.com/palace.png', undefined, [], 'cinematic-natural');
    assert.equal(task, 'task-preserved-contract');
    assert.ok(submitted.prompt.length > 4000);
    assert.match(submitted.prompt, /NAMED CAST \(3\)/);
    for (let i = 1; i <= 4; i++) assert.match(submitted.prompt, new RegExp(`Reference image ${i}:`));
    assert.match(submitted.prompt, /No captions, subtitles, dialogue text/);
    assert.match(submitted.prompt, /No unrelated person, object, scenery or decoration\.$/);
    assert.equal(submitted.image_urls.length, 4);
  } finally {
    axios.post = originalPost;
  }
});

test('structured GPT grids deliver photographic treatment without losing panels or reference order', async () => {
  const panelText = Array.from({ length: 4 }, (_, i) => `Panel ${i + 1}: preserve shot-${i + 1}-sentinel at its authored camera distance.`).join('\n');
  const prompt = `UNIQUE STORYBOARD BATCH: test-1\nGRID STYLE BIBLE (authoritative): keep every panel.\n${panelText}`;
  const board = { id: 'grid', sceneNumber: 1, characters: ['Luna'], objects: [], prompt };
  const references = ['https://example.com/identity.png', 'https://example.com/location.png'];
  const labels = ['Luna: IDENTITY ONLY', 'Empty hall: ENVIRONMENT ONLY'];
  const originalPost = axios.post;
  let submitted;
  axios.post = async (_url, body) => {
    submitted = body;
    return { data: { code: 200, data: [{ task_id: 'grid-contract' }] } };
  };
  try {
    for (const style of ['cinematic-natural', 'anime']) {
      await generateStoryboardImage(board, [{ name: 'Luna', description: 'The approved character' }], 'test-only', [], '9:16', 'gpt-image-2', {}, undefined, references, labels, style);
      assert.ok(submitted.prompt.startsWith(prompt));
      for (let i = 1; i <= 4; i++) assert.ok(submitted.prompt.includes(`shot-${i}-sentinel`));
      assert.deepEqual(submitted.image_urls, references);
      if (style === 'anime') assert.doesNotMatch(submitted.prompt, /PHOTOGRAPHIC SURFACE AND OPTICS/);
      else {
        assert.match(submitted.prompt, /Use the light already present/);
        assert.match(submitted.prompt, /Apply separately at each view/);
      }
    }
    await generateStoryboardImage(board, [], 'test-only', [], '9:16', 'seedream-5-0-pro', {}, undefined, references, labels, 'cinematic-natural');
    assert.equal(submitted.prompt, prompt);
  } finally {
    axios.post = originalPost;
  }
});

test('real four-cell prompts reach the provider intact even with no uploaded references', async () => {
  const originalPost = axios.post;
  const submissions = [];
  axios.post = async (_url, body) => {
    submissions.push(body);
    return { data: { data: [{ task_id: 'two-by-two-layout' }] } };
  };
  try {
    for (const model of ['seedream-5-0-pro', 'gpt-image-2', 'gemini-3.1-flash-image-preview']) {
      for (const ratio of ['9:16', '16:9', '1:1']) {
        for (const references of [undefined, [], ['https://example.com/queen.png', 'https://example.com/mask.png']]) {
          const labels = references?.length ? ['CHARACTER IDENTITY: queen', 'OBJECT IDENTITY: mask'] : [];
          const prompt = buildGridPrompt('palace', 'queen', Array.from({ length: 4 }, (_, index) =>
            `ACTION_${index + 1}: queen lifts the mask. Only queen appears in this frame, one instance of each.`), ratio, labels, [5, 6, 7, 8], 'cinematic-natural', undefined, model);
          const before = submissions.length;
          const task = await generateStoryboardImage({ id: 'grid', sceneNumber: 5, characters: ['queen'], objects: [], prompt },
            [{ name: 'queen', description: 'Approved queen identity' }], 'test-only', [], ratio, model, {}, undefined, references, labels, 'cinematic-natural');
          assert.equal(task, 'two-by-two-layout');
          assert.equal(submissions.length, before + 1, 'submit once; no new QC or regeneration calls');
          const submitted = submissions.at(-1);
          assert.ok(submitted.prompt.startsWith(prompt), `${model}/${ratio}/${references?.length ?? 'undefined'} must keep the grid prompt first`);
          if (model !== 'gpt-image-2') assert.equal(submitted.prompt, prompt);
          assert.match(submitted.prompt, /exactly two columns and two rows/);
          for (let index = 1; index <= 4; index++) assert.ok(submitted.prompt.includes(`ACTION_${index}:`));
          assert.doesNotMatch(submitted.prompt, /EXACT CAST \(1 total\)|NAMED CAST \(1\)|IMAGE GOAL:/, 'do not append a single-shot wrapper');
          assert.deepEqual(submitted.image_urls || [], references || []);
          assert.equal(submitted.size, ratio);
          assert.equal(submitted.resolution.toUpperCase(), model === 'seedream-5-0-pro' ? '2K' : '4K');
          assert.equal(submitted.n, 1);
        }
      }
    }
  } finally {
    axios.post = originalPost;
  }
});
