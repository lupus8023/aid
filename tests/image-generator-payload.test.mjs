import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { generateStoryboardImage } from '../lib/imageGenerator.ts';

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
    assert.match(submitted.prompt, /EXACT CAST \(3 total\)/);
    for (let i = 1; i <= 4; i++) assert.match(submitted.prompt, new RegExp(`Reference image ${i}:`));
    assert.match(submitted.prompt, /No captions, subtitles, dialogue text/);
    assert.match(submitted.prompt, /No unrelated person, object, scenery or decoration\.$/);
    assert.equal(submitted.image_urls.length, 4);
  } finally {
    axios.post = originalPost;
  }
});
