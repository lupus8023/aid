import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APIMART_IMAGE_MODEL_OPTIONS,
  buildImageGenerationPayload,
  extractImageTaskId,
  getImageModelCapabilities,
  imageModelRequiresApiKey,
} from '../lib/imageModels.ts';

test('exposes both new providers in the global image-model selector', () => {
  const models = APIMART_IMAGE_MODEL_OPTIONS.map(option => option.value);
  assert.ok(models.includes('grok-imagine-image-2.0'));
  assert.ok(models.includes('gemini-3.1-flash-image-preview'));
  assert.ok(models.includes('comfyui-z-image-turbo'));
});

test('advertises Z-Image-Turbo as a local text-only provider', () => {
  const capabilities = getImageModelCapabilities('comfyui-z-image-turbo');
  assert.equal(capabilities.maxReferenceImages, 0);
  assert.equal(capabilities.maxResolution, '2K');
  assert.equal(imageModelRequiresApiKey('comfyui-z-image-turbo'), false);
});

test('builds the official Grok Imagine 2.0 generation payload', () => {
  const request = buildImageGenerationPayload({
    model: 'grok-imagine-image-2.0',
    prompt: 'cinematic portrait',
    aspectRatio: '9:16',
    imageUrls: [],
    resolutionOverride: '4K',
  });

  assert.equal(request.body.aspect_ratio, '9:16');
  assert.equal(request.body.size, undefined);
  assert.equal(request.body.resolution, '2k');
  assert.equal(request.body.quality, 'medium');
  assert.equal(request.extraHeaders['X-APIMart-Response-Version'], '2026-07-27');
  assert.equal(extractImageTaskId({ code: 202, data: { id: 'task_grok' } }), 'task_grok');
});

test('omits Grok quality during editing and limits references to three', () => {
  const request = buildImageGenerationPayload({
    model: 'grok-imagine-image-2.0',
    prompt: 'edit the scene',
    aspectRatio: '16:9',
    imageUrls: ['1.png', '2.png', '3.png', '4.png'],
  });

  assert.deepEqual(request.body.image_urls, ['1.png', '2.png', '3.png']);
  assert.equal(request.body.quality, undefined);
  assert.equal(getImageModelCapabilities('grok-imagine-image-2.0').maxReferenceImages, 3);
});

test('builds Nano Banana 2 text and multi-reference payloads up to 4K', () => {
  const images = Array.from({ length: 14 }, (_, index) => `${index + 1}.png`);
  const request = buildImageGenerationPayload({
    model: 'gemini-3.1-flash-image-preview',
    prompt: 'character board',
    aspectRatio: '4:3',
    imageUrls: images,
    resolutionOverride: '4K',
  });

  assert.equal(request.body.size, '4:3');
  assert.equal(request.body.aspect_ratio, undefined);
  assert.equal(request.body.resolution, '4K');
  assert.deepEqual(request.body.image_urls, images);
  assert.equal(getImageModelCapabilities('nano-banana-2-ext').maxReferenceImages, 14);
  assert.equal(extractImageTaskId({ code: 200, data: [{ task_id: 'task_nano' }] }), 'task_nano');
});
