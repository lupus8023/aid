import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';
import { createStoryImageRequestPreparer, MAX_STORY_IMAGE_REQUEST_BYTES } from '../lib/storyImageRequest.ts';
import { isRequestTooLargeError } from '../lib/apiResponse.ts';
import { generateStoryboardImage } from '../lib/imageGenerator.ts';

const url = name => `https://example.com/${name}.png`;
const image = 'data:image/png;base64,aW1hZ2UtYnl0ZXM=';
const shot = {
  id: 'shot1', sceneNumber: 1, status: 'pending', characters: ['A'], objects: ['mask'],
  prompt: 'A lifts the mask, then lowers it onto a tray.', description: 'A holds the mask.',
  action: 'A lowers the mask.', shotSize: 'medium', angle: 'eye-level', cameraMove: 'static',
  characterCostume: { A: 'red robe' }, sceneStyle: 'Warm side light in the hall.',
};
function input(extra = {}) {
  return {
    storyboard: structuredClone(shot),
    characters: [{ id: 'a', name: 'A', description: 'Adult in a red robe', imageUrl: url('a') }],
    objects: [{ id: 'mask', name: 'mask', description: 'Black gauze mask', imageUrl: url('mask') }],
    costumeImages: { A: url('costume') }, sceneImage: url('hall'),
    aspectRatio: '16:9', imageModel: 'gpt-image-2', apiKey: 'test-only', visualStyle: 'cinematic-natural',
    ...extra,
  };
}
const noNetwork = async () => { throw new Error('Unexpected network request'); };

test('grid submission strips multi-megabyte stored originals and unrelated media without changing authored text', async () => {
  const large = 'data:image/png;base64,' + 'a'.repeat(4 * 1024 * 1024);
  const value = input({
    storyboard: { ...shot, imageUrl: large, videoUrl: large, videoPrompt: 'not an image instruction', videoDuplicateHistory: [{ original: large }] },
    characters: [{ id: 'a', name: 'A', description: 'Adult in a red robe', imageUrl: url('a'), imageBase64: large, imageFile: { bytes: large } }],
    objects: [{ id: 'mask', name: 'mask', description: 'Black gauze mask', imageUrl: url('mask'), imageBase64: large }],
    costumeImages: { A: url('costume'), Offshot: large },
    referenceImages: [url('mask'), url('costume'), url('hall')],
    referenceImageLabels: ['OBJECT: mask', 'CHARACTER: A', 'ENVIRONMENT: hall'],
  });
  const originalBytes = Buffer.byteLength(JSON.stringify(value));
  const body = await createStoryImageRequestPreparer(noNetwork)(value);
  const prepared = JSON.parse(body);
  assert.ok(originalBytes > 20 * 1024 * 1024);
  assert.ok(Buffer.byteLength(body) < 3000);
  assert.doesNotMatch(body, /imageBase64|imageFile|videoUrl|videoPrompt|data:image/);
  assert.deepEqual(prepared.referenceImages, value.referenceImages);
  assert.deepEqual(prepared.referenceImageLabels, value.referenceImageLabels);
  assert.equal(prepared.storyboard.prompt, shot.prompt);
  assert.equal(prepared.storyboard.action, shot.action);
  assert.deepEqual(prepared.costumeImages, {});
  assert.equal(prepared.sceneImage, '');
  assert.equal(value.characters[0].imageBase64, large, 'saved project must remain intact');
});

test('single-image recovery carries only visible reference images and keeps the costume-source flag', async () => {
  const value = input({ characters: [
    { id: 'a', name: 'A', description: 'red robe', imageUrl: url('a'), imageBase64: image },
    { id: 'b', name: 'B', description: 'off-shot', imageUrl: 'blob:unused', imageBase64: image },
  ], costumeImages: { A: url('costume'), B: 'blob:unused-costume' } });
  const prepared = JSON.parse(await createStoryImageRequestPreparer(noNetwork)(value));
  assert.equal(prepared.characters[0].imageUrl, url('costume'));
  assert.equal(prepared.characters[1].imageUrl, '');
  assert.deepEqual(prepared.costumeImages, { A: url('costume') });
  assert.equal(prepared.sceneImage, url('hall'));
  assert.deepEqual(prepared.storyboard.characterCostume, shot.characterCostume);
});

test('empty shots keep legacy API cast metadata but send no character images', async () => {
  const value = input({ storyboard: { ...shot, characters: [], objects: [], prompt: 'An empty hall.' } });
  const prepared = JSON.parse(await createStoryImageRequestPreparer(noNetwork)(value));
  assert.equal(prepared.characters.length, 1);
  assert.equal(prepared.characters[0].imageUrl, '');
  assert.deepEqual(prepared.objects, []);
  assert.deepEqual(prepared.costumeImages, {});
});

function uploadMock({ failFirst = false, invalidTicket = false } = {}) {
  const calls = { signing: 0, uploads: 0, bytes: [] };
  const request = async (target, init) => {
    if (String(target).startsWith('data:')) return fetch(target);
    if (target === '/api/media-upload/sign') {
      calls.signing++;
      assert.deepEqual(JSON.parse(init.body), { folder: 'aid-images', resource_type: 'image' });
      assert.ok(init.body.length < 100);
      return Response.json({ targets: [{ url: invalidTicket ? 'https://untrusted.example/upload' : 'https://api.cloudinary.com/v1_1/test/image/upload', fields: { signature: 'test-only', timestamp: '1' } }] });
    }
    assert.equal(target, 'https://api.cloudinary.com/v1_1/test/image/upload');
    assert.ok(init.body instanceof FormData);
    const file = init.body.get('file');
    calls.bytes.push(Buffer.from(await file.arrayBuffer()).toString());
    calls.uploads++;
    if (failFirst && calls.uploads === 1) return Response.json({ error: { message: 'Upload failed' } }, { status: 500 });
    return Response.json({ secure_url: 'https://res.cloudinary.com/test/image/upload/reference.png' });
  };
  return { request, calls };
}

test('raw references upload as exact multipart bytes once while reference order and duplicate roles remain intact', async () => {
  const { request, calls } = uploadMock();
  const prepare = createStoryImageRequestPreparer(request);
  const value = input({ referenceImages: [image, url('hall'), image], referenceImageLabels: ['identity', 'environment', 'prop'] });
  const results = await Promise.all([prepare(value), prepare(value)]);
  assert.equal(calls.uploads, 1);
  assert.equal(calls.signing, 1);
  assert.deepEqual(calls.bytes, ['image-bytes']);
  const prepared = JSON.parse(results[0]);
  assert.equal(prepared.referenceImages.length, 3);
  assert.equal(prepared.referenceImages[0], prepared.referenceImages[2]);
  assert.equal(prepared.referenceImages[1], url('hall'));
  assert.deepEqual(prepared.referenceImageLabels, value.referenceImageLabels);
  assert.doesNotMatch(results[0], /data:image|imageBase64/);
});

test('expired browser object URLs use the retained original before upload', async () => {
  const { request, calls } = uploadMock();
  const prepared = JSON.parse(await createStoryImageRequestPreparer(request)(input({
    characters: [{ id: 'a', name: 'A', description: 'red robe', imageUrl: 'blob:expired', imageBase64: image }],
    costumeImages: {}, referenceImages: ['blob:expired'], referenceImageLabels: ['A'],
  })));
  assert.equal(calls.uploads, 1);
  assert.equal(prepared.characters[0].imageUrl, prepared.referenceImages[0]);
});

test('local pages use the existing multipart relay without requesting unavailable signing credentials', async () => {
  let uploads = 0;
  const request = async (target, init) => {
    if (String(target).startsWith('data:')) return fetch(target);
    assert.equal(target, '/api/upload-image');
    assert.ok(init.body instanceof FormData);
    assert.equal(await init.body.get('image').text(), 'image-bytes');
    uploads++;
    return Response.json({ url: url('uploaded-local') });
  };
  const prepared = JSON.parse(await createStoryImageRequestPreparer(request, true)(input({ referenceImages: [image, image] })));
  assert.equal(uploads, 1);
  assert.deepEqual(prepared.referenceImages, [url('uploaded-local'), url('uploaded-local')]);
});

test('failed uploads stop preparation and can be retried explicitly; no broken promise is cached', async () => {
  const { request, calls } = uploadMock({ failFirst: true });
  const prepare = createStoryImageRequestPreparer(request);
  const value = input({ referenceImages: [image], referenceImageLabels: ['A'] });
  await assert.rejects(prepare(value), /Upload failed/);
  await prepare(value);
  assert.equal(calls.uploads, 2);
});

test('upload targets outside the configured storage service never receive image bytes', async () => {
  const { request, calls } = uploadMock({ invalidTicket: true });
  await assert.rejects(createStoryImageRequestPreparer(request)(input({ referenceImages: [image] })), /上传签名无效/);
  assert.equal(calls.uploads, 0);
});

test('storage file-size rejection is terminal even when storage returns HTTP 400 instead of 413', async () => {
  const { request } = uploadMock();
  const sizeRejected = (target, init) => String(target).startsWith('https://api.cloudinary.com/')
    ? Promise.resolve(Response.json({ error: { message: 'File size too large. Maximum is 10485760.' } }, { status: 400 }))
    : request(target, init);
  await assert.rejects(createStoryImageRequestPreparer(sizeRejected)(input({ referenceImages: [image] })), error => isRequestTooLargeError(error));
});

test('oversized text metadata is rejected locally without truncation or a generation request', async () => {
  const value = input({ storyboard: { ...shot, prompt: '长'.repeat(MAX_STORY_IMAGE_REQUEST_BYTES / 2) } });
  await assert.rejects(createStoryImageRequestPreparer(noNetwork)(value), error => isRequestTooLargeError(error));
});

test('lean serialization preserves the provider prompt and ordered references for grid and single-shot requests', async () => {
  const originalPost = axios.post;
  const submitted = [];
  axios.post = async (_url, body) => { submitted.push(body); return { data: { data: [{ task_id: 'test-transport-only' }] } }; };
  const generate = value => generateStoryboardImage(value.storyboard, value.characters, value.apiKey, value.objects,
    value.aspectRatio, value.imageModel, value.costumeImages, value.sceneImage, value.referenceImages,
    value.referenceImageLabels, value.visualStyle, value.capturePreset);
  try {
    for (const grid of [false, true]) {
      const value = input(grid ? { referenceImages: [url('mask'), url('costume'), url('hall')], referenceImageLabels: ['OBJECT: mask', 'CHARACTER: A', 'ENVIRONMENT: hall'] } : {});
      await generate(value);
      await generate(JSON.parse(await createStoryImageRequestPreparer(noNetwork)(value)));
      const [before, after] = submitted.slice(-2);
      assert.equal(after.prompt, before.prompt);
      assert.deepEqual(after.image_urls, before.image_urls);
    }
  } finally { axios.post = originalPost; }
});

test('Story prepares both grid and single submissions only when no recoverable task exists, and stops on 413', async () => {
  const source = await readFile(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/await prepareImageRequestRef\.current\(/g) || []).length, 2);
  assert.equal((source.match(/body: requestBody/g) || []).length, 2);
  assert.match(source, /if \(isImageSafetyRejection\(error\) \|\| isRequestTooLargeError\(error\)\) throw error/);
  assert.match(source, /if \(!taskId\) \{\s+const requestBody = await prepareImageRequestRef\.current/g);
});
