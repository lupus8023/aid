import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APIMART_IMAGE_MODEL_OPTIONS,
  buildImageGenerationPayload,
  extractImageTaskId,
  getImageModelCapabilities,
  imageModelRequiresApiKey,
  isMidjourneyImageModel,
  resolveStoryboardGridImageModel,
} from '../lib/imageModels.ts';
import { buildStudioImagePrompt, imageCreationInputError } from '../lib/imageCreation.ts';
import {
  buildMidjourneyImaginePayload,
  buildMidjourneyPrompt,
  isMidjourneyTask,
  resolveMidjourneyProfileSetting,
  unwrapMidjourneyTaskId,
} from '../lib/midjourney.ts';

test('exposes both new providers in the global image-model selector', () => {
  const models = APIMART_IMAGE_MODEL_OPTIONS.map(option => option.value);
  assert.ok(models.includes('grok-imagine-image-2.0'));
  assert.ok(models.includes('gemini-3.1-flash-image-preview'));
  assert.ok(models.includes('comfyui-z-image-turbo'));
  assert.ok(models.includes('midjourney'));
  assert.ok(models.includes('seedream-5-0-pro'));
  assert.ok(!models.includes('doubao-seedream-5-0-lite'));
});

test('uses Seedream 5.0 Pro capabilities and clamps storyboard grid requests to its supported 2K ceiling', () => {
  const capabilities = getImageModelCapabilities('seedream-5-0-pro');
  assert.equal(capabilities.maxReferenceImages, 10);
  assert.equal(capabilities.maxResolution, '2K');
  const payload = buildImageGenerationPayload({
    model: 'seedream-5-0-pro',
    prompt: 'strict 3x3 cinematic storyboard',
    aspectRatio: '16:9',
    imageUrls: Array.from({ length: 12 }, (_, index) => `https://example.com/reference-${index}.png`),
    resolutionOverride: '4K',
  });
  assert.equal(payload.body.model, 'seedream-5-0-pro');
  assert.equal(payload.body.size, '16:9');
  assert.equal(payload.body.resolution, '2K');
  assert.equal(payload.body.image_urls.length, 10);
});

test('advertises Midjourney as an APIMart quality-first model with scene plus identity references', () => {
  const capabilities = getImageModelCapabilities('midjourney');
  assert.equal(isMidjourneyImageModel('midjourney'), true);
  assert.equal(capabilities.maxReferenceImages, 4);
  assert.equal(capabilities.maxResolution, '2K');
  assert.equal(imageModelRequiresApiKey('midjourney'), true);
  assert.equal(imageCreationInputError({ model: 'midjourney', referenceCount: 0, userIntent: 'Rainy laboratory at dawn' }), '');
  assert.equal(resolveStoryboardGridImageModel('midjourney'), 'gemini-3.1-flash-image-preview');
  assert.equal(resolveStoryboardGridImageModel('seedream-5-0-pro'), 'seedream-5-0-pro');
});

test('injects the selected Midjourney V8.2 personalization profile outside editable prompt prose', () => {
  const payload = buildMidjourneyImaginePayload({
    prompt: 'Cinematic portrait of a woman beside a rain-dark window --profile should-be-removed',
    aspectRatio: '16:9',
    visualStyle: 'cinematic-natural',
    taskMode: 'single',
    hasPeople: true,
    personalizationProfile: 'votj2t8',
  });
  assert.equal(payload.extra, '--profile votj2t8');
  assert.equal(payload.metadata.personalization_profile, 'votj2t8');
  assert.doesNotMatch(payload.prompt, /--profile/i);
  assert.equal(resolveMidjourneyProfileSetting({ midjourneyProfileEnabled: true, midjourneyProfile: 'abc_123' }), 'abc_123');
  assert.equal(resolveMidjourneyProfileSetting({ midjourneyProfileEnabled: false, midjourneyProfile: 'abc_123' }), '');
});

test('compiles GPT-Image contracts into a concise Midjourney finished-frame prompt', () => {
  const prompt = buildMidjourneyPrompt(`IMAGE GOAL:\nDr. Pan holds a translucent facial mask beside a rain-streaked laboratory window, medium close-up.\n\nOUTPUT CONSTRAINTS:\nOne complete frame. No captions.\n\nREFERENCE JOBS — each input has one job only:\nReference image 1: strict identity.`, {
    visualStyle: 'cinematic-natural', taskMode: 'single', hasPeople: true,
  });
  assert.match(prompt, /Dr\. Pan holds a translucent facial mask/);
  assert.match(prompt, /high-budget live-action feature|real human actor/i);
  assert.match(prompt, /natural anatomy, restrained expression/i);
  assert.doesNotMatch(prompt, /OUTPUT CONSTRAINTS|REFERENCE JOBS|strict identity/);
  assert.ok(prompt.length <= 1100);
});

test('preserves selected film looks instead of flattening every Midjourney prompt to one style', () => {
  const warm = buildMidjourneyPrompt('IMAGE GOAL:\nA woman waits beside a late-night window', {
    visualStyle: 'warm-film', taskMode: 'single', hasPeople: true,
  });
  const noir = buildMidjourneyPrompt('IMAGE GOAL:\nA woman waits beside a late-night window', {
    visualStyle: 'neo-noir', taskMode: 'single', hasPeople: true,
  });
  assert.match(warm, /photochemical 35mm|irregular grain|restrained halation/i);
  assert.match(noir, /cyan-black|negative fill|textured shadows/i);
  assert.notEqual(warm, noir);
});

test('compiles the project capture preset into the actual Midjourney prompt', () => {
  const payload = buildMidjourneyImaginePayload({
    prompt: 'IMAGE GOAL:\nNana walks past a Shanghai street shop and glances at the window display.',
    aspectRatio: '16:9',
    visualStyle: 'cinematic-natural',
    capturePreset: 'broadcast-candid',
    taskMode: 'story-shot',
    hasPeople: true,
  });
  assert.match(String(payload.prompt), /live-television candid long-lens observation/i);
  assert.match(String(payload.prompt), /foreground pedestrian or street-object occlusion/i);
  assert.match(String(payload.prompt), /broadcast compression/i);
  assert.match(String(payload.prompt), /no influencer pose or beauty retouching/i);
  assert.equal(payload.metadata.capture_preset, 'broadcast-candid');
});

test('keeps all nine Midjourney panels and uses grid-safe negative terms', () => {
  const panels = Array.from({ length: 9 }, (_, index) => `Panel ${index + 1} (story scene ${index + 1}): UNIQUE_MJ_SHOT_${index + 1}, a distinct camera position and action.`).join('\n');
  const source = `UNIQUE STORYBOARD BATCH: 1-9\nRender these nine distinct moments in exact order:\n${panels}\n\nScene continuity: one laboratory at dawn.`;
  const payload = buildMidjourneyImaginePayload({
    prompt: source, aspectRatio: '16:9', imageUrls: ['https://example.com/soft-reference.png'], referenceMode: 'image', visualStyle: 'warm-film', taskMode: 'grid', hasPeople: true,
  });
  for (let index = 1; index <= 9; index += 1) assert.match(String(payload.prompt), new RegExp(`UNIQUE_MJ_SHOT_${index}`));
  assert.match(String(payload.prompt), /exactly nine complete/i);
  assert.match(String(payload.prompt), /three equal horizontal rows|three equal columns/i);
  assert.doesNotMatch(String(payload.negative_prompt), /split screen|duplicate people/i);
  assert.match(String(payload.negative_prompt), /irregular grid|missing panels/i);
  assert.match(String(payload.negative_prompt), /six panels|2x3 layout/i);
  assert.equal(payload.version, '8.2');
  assert.equal(payload.hd, true);
  assert.deepEqual(payload.image_urls, ['https://example.com/soft-reference.png']);
  assert.equal(payload.iw, 0.65);
  assert.match(String(payload.negative_prompt), /3D render|doll|plastic skin/i);
});

test('keeps character-card shots on V8.2 with a stronger soft image reference', () => {
  const payload = buildMidjourneyImaginePayload({
    prompt: 'IMAGE GOAL:\nA doctor in practical laboratory light',
    aspectRatio: '16:9',
    imageUrls: ['https://example.com/character.png'],
    referenceMode: 'character',
  });
  assert.equal(payload.version, '8.2');
  assert.equal(payload.size, '16:9');
  assert.equal(payload.raw, true);
  assert.equal(payload.hd, true);
  assert.equal(payload.stylize, 40);
  assert.equal(payload.extra, undefined);
  assert.equal(payload.cref, undefined);
  assert.equal(payload.cw, undefined);
  assert.deepEqual(payload.image_urls, ['https://example.com/character.png']);
  assert.equal(payload.iw, 0.65);
  assert.match(String(payload.negative_prompt), /subtitles/);
});

test('keeps the environment reference and rejects portrait fallback for Story shots', () => {
  const payload = buildMidjourneyImaginePayload({
    prompt: 'IMAGE GOAL:\nThe mermaid crosses a flooded throne room while guards close the bronze gates.',
    aspectRatio: '16:9',
    imageUrls: [
      'https://example.com/throne-room.png',
      'https://example.com/mermaid.png',
      'https://example.com/guard.png',
    ],
    referenceMode: 'image',
    visualStyle: 'cinematic-natural',
    taskMode: 'story-shot',
    hasPeople: true,
  });
  assert.deepEqual(payload.image_urls, [
    'https://example.com/throne-room.png',
    'https://example.com/mermaid.png',
    'https://example.com/guard.png',
  ]);
  assert.equal(payload.iw, 0.55);
  assert.match(String(payload.prompt), /staged inside the described location/i);
  assert.match(String(payload.prompt), /ignore their layout, name and typography/i);
  assert.match(String(payload.negative_prompt), /studio portrait|character sheet|isolated turnaround/i);
  assert.match(String(payload.negative_prompt), /reference-card typography|character name|letterbox title/i);
});

test('keeps Midjourney task identities distinguishable from unified APIMart tasks', () => {
  assert.equal(isMidjourneyTask('midjourney:task_123'), true);
  assert.equal(unwrapMidjourneyTaskId('midjourney:task_123'), 'task_123');
  assert.equal(isMidjourneyTask('task_123'), false);
});

test('advertises Z-Image-Turbo as a local text-only provider', () => {
  const capabilities = getImageModelCapabilities('comfyui-z-image-turbo');
  assert.equal(capabilities.maxReferenceImages, 0);
  assert.equal(capabilities.maxResolution, '2K');
  assert.equal(imageModelRequiresApiKey('comfyui-z-image-turbo'), false);
});

test('allows Z-Image-Turbo generation without references once a prompt is provided', () => {
  assert.equal(imageCreationInputError({
    model: 'comfyui-z-image-turbo',
    referenceCount: 0,
    userIntent: 'A red ceramic vase in window light',
  }), '');
  assert.match(imageCreationInputError({
    model: 'comfyui-z-image-turbo',
    referenceCount: 0,
    userIntent: '   ',
  }), /描述目标画面/);
  assert.match(imageCreationInputError({
    model: 'gpt-image-2',
    referenceCount: 0,
    userIntent: 'A red ceramic vase',
  }), /参考图片/);
});

test('builds a reference-free prompt for Z-Image-Turbo', () => {
  const prompt = buildStudioImagePrompt({
    userIntent: 'A red ceramic vase in window light',
    scaleNotes: 'The vase is 30 cm tall',
    usesReferenceImages: false,
  });

  assert.match(prompt, /A red ceramic vase in window light/);
  assert.match(prompt, /30 cm tall/);
  assert.doesNotMatch(prompt, /provided reference images/i);
  assert.match(prompt, /No random text, watermark, subtitles/);
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
